"""Filling an entry's fields from what was said, with Jev choosing and never writing.

TypeSafe's pre-parsed extraction pattern: code lists candidate values from the
observation's own words -- every short phrase in its note and in the quote --
and Jev picks the one a field asks for, or none. So a filled value is always
copied from what was said: it cannot be invented, and a field Jev is unsure
of is left empty rather than guessed. A field with a fixed set of values is a
choice over exactly those values. Long text is not chosen at all: the note
itself goes to the type's notes field, so nothing said is lost when the name
is only three words of it.

All of a type's questions go in one request, answered in parallel. The fields,
their labels, hints and values come from the manifest
(pack_loader.fill_fields), so a new type is filled with no code here.

Off unless TYPESAFE_API_KEY is set, as routing.py is, and for the same reason.
"""

import logging
import os
import re

import httpx

import routing

logger = logging.getLogger(__name__)

# A value is filled at or above these. From the 2026-09-30 trial on 16
# observations across ten types: a wrong fixed value came at 0.59 while every
# right one was 0.71 or more, so choices take 0.7; right names and titles came
# as low as 0.30 ("senior designer"), and a name left empty falls back to the
# whole note anyway, so they take 0.3; other text takes 0.5.
FILL_AT = {"identifier": 0.3, "text": 0.5, "enum": 0.7}
NONE = "none"
NOT_STATED = "not_stated"
MAX_WORDS = 8
MAX_OPTIONS = 250  # Jev takes 255 a question, and none is one

# A phrase that starts or ends on one of these is not a value anyone means:
# "at the University" is, at best, "the University".
STOP = frozenset("""
a an the and or but nor of to in on at for with by from as is are was were be been being am
it its it's that this these those than then rather not no so very just also into onto over
about after before while when who whom which what where why how her his their my your our
i me we you he she they them him us s t has have had do does did will would can could
should may might must each every some any all both either neither such own same too more
most much many few less least again ever still
""".split())

_TOKEN = re.compile(r"\S+")
_EDGE = "\"'“”‘’()[]{},;:!?."
# A phrase stops at the end of a clause: "urban history, especially
# Manchester's canals" is not an interest's name.
_BREAK = re.compile(r"[.;:!?,]$")


def _phrases(text: str) -> list[str]:
    """Every run of one to MAX_WORDS words in `text`, trimmed of the punctuation
    at its edges, that neither starts nor ends on a small word and does not run
    across a comma or the end of a sentence."""
    tokens = [(m.start(), m.end(), m.group()) for m in _TOKEN.finditer(text or "")]
    out = []
    for i in range(len(tokens)):
        for j in range(i, min(i + MAX_WORDS, len(tokens))):
            if j > i and _BREAK.search(tokens[j - 1][2]):
                break  # the previous word ended a sentence
            phrase = text[tokens[i][0]:tokens[j][1]].strip(_EDGE)
            words = phrase.split()
            if not words:
                continue
            first, last = words[0].lower().strip(_EDGE), words[-1].lower().strip(_EDGE)
            if first in STOP or last in STOP:
                continue
            out.append(phrase)
    return out


def candidates(observation: dict) -> list[str]:
    """Phrases from the note, then from the quote, first spelling kept, no repeats."""
    seen, out = set(), []
    for source in (observation.get("note"), observation.get("evidence")):
        for phrase in _phrases(source or ""):
            if phrase.lower() not in seen:
                seen.add(phrase.lower())
                out.append(phrase)
    if len(out) > MAX_OPTIONS:
        # Short phrases first: a value is rarely the longest run of words.
        out = sorted(out, key=lambda p: len(p.split()))[:MAX_OPTIONS]
    return out


def _hint(field: dict) -> str:
    hint = (field.get("placeholder") or "").strip().rstrip(".…").removeprefix("e.g.").strip()
    return f" (for example {hint})" if hint else ""


def questions(target: dict, observation: dict) -> dict[str, dict]:
    """One question per field Jev can fill, keyed by the field's MCP spelling."""
    phrases = candidates(observation)
    whole = (observation.get("note") or "").strip().rstrip(".")
    kind = target["title"]
    out = {}
    for field in target["fields"]:
        if field["type"] == "enum":
            criteria = {v: v.replace("_", " ") for v in field["values"]}
            criteria[NOT_STATED] = "The observation does not say"
            out[field["key"]] = {
                "type": "choice",
                "instructions": f"What is the {field['label'].lower()} of this {kind.lower()}, if the observation says?",
                "criteria": criteria,
            }
        elif field["type"] in ("text", "date"):
            options = list(phrases)
            # A title can be the whole sentence ("Run a half marathon by spring").
            if field["identifier"] and whole and whole.lower() not in {p.lower() for p in options}:
                options.append(whole)
            if not options:
                continue
            criteria = {p: p for p in options}
            criteria[NONE] = "None of these: the observation does not say"
            out[field["key"]] = {
                "type": "choice",
                "instructions": (
                    f"Which words in the observation are the {field['label'].lower()} of this "
                    f"{kind.lower()}{_hint(field)}? Choose none if it does not say."
                ),
                "criteria": criteria,
            }
    return out


def notes_field(target: dict) -> str | None:
    """Where the note itself goes: a required long text field first (a project's
    description), then one called notes, then any long text."""
    long = [f for f in target["fields"] if f["type"] == "longtext"]
    for pick in (
        next((f for f in long if f["required"]), None),
        next((f for f in long if f["key"] in ("notes", "note")), None),
        long[0] if long else None,
    ):
        if pick:
            return pick["key"]
    return None


async def fill(observation: dict, target: dict, client: httpx.AsyncClient | None = None) -> dict:
    """{enabled, values: {key: value}, confidence: {key: 0-1}}.

    Values Jev chose at FILL_AT or above, and the note in the notes field when
    the name is not already the whole of it. No key, or any failure, is no
    values: the dialog then offers the note as the name, as it always did.
    """
    key = os.getenv("TYPESAFE_API_KEY")
    if not key:
        return {"enabled": False, "values": {}, "confidence": {}}
    asked = questions(target, observation)
    values, confidence = {}, {}
    if asked:
        state = {k: observation[k] for k in ("note", "rationale", "evidence") if observation.get(k)}
        body = {"model": routing.MODEL, "state": state, "questions": asked}
        try:
            if client is None:
                async with httpx.AsyncClient(timeout=routing.TIMEOUT_S) as own:
                    response = await own.post(routing.URL, headers={"Authorization": f"Bearer {key}"}, json=body)
            else:
                response = await client.post(routing.URL, headers={"Authorization": f"Bearer {key}"}, json=body)
            response.raise_for_status()
            answers = response.json()["answers"]
        except (httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError) as exc:
            logger.warning("filling: no values for an observation (%s)", exc)
            return {"enabled": True, "values": {}, "confidence": {}}
        kinds = {f["key"]: "identifier" if f["identifier"] else ("enum" if f["type"] == "enum" else "text")
                 for f in target["fields"]}
        for field_key, question in asked.items():
            answer = answers.get(field_key) if isinstance(answers, dict) else None
            if not isinstance(answer, dict):
                continue
            choice, sure = answer.get("choice"), float(answer.get("confidence") or 0)
            if choice in (None, NONE, NOT_STATED) or choice not in question["criteria"]:
                continue
            if sure < FILL_AT[kinds[field_key]]:
                continue
            values[field_key] = choice
            confidence[field_key] = round(sure, 3)

    note = (observation.get("note") or "").strip()
    identifier = next((f["key"] for f in target["fields"] if f["identifier"]), None)
    where = notes_field(target)
    if note and where and where not in values and values.get(identifier, "").lower() != note.rstrip(".").lower():
        values[where] = note
    return {"enabled": True, "values": values, "confidence": confidence}
