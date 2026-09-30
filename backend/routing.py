"""Where an observation belongs, suggested by TypeSafe's Jev.

Off unless TYPESAFE_API_KEY is set. When it is, an observation's note, its
reason and the words it quoted are sent to TypeSafe to choose from: the third
way data leaves the server, after the AI client itself and an embeddings
provider, so it is the operator's choice, as EMBEDDING_API_KEY is.

Jev picks one option from a list and says how sure it is; it writes nothing.
The options are the types the Promote dialog offers, from
pack_loader.derive_promotion_targets, and each option's criterion is its
manifest `about` -- the same words the dialog shows under the type. So a pack
that declares a new type is routed to with no code here, and the model and
the reader are never told two different things about what a type means.

The suggestions only order and pre-fill the dialog. Nothing is filed until the
reader chooses Promote.
"""

import logging
import os

import httpx

logger = logging.getLogger(__name__)

URL = os.getenv("TYPESAFE_API_URL") or "https://api.typesafe.ai/v1/systemone"
MODEL = os.getenv("TYPESAFE_MODEL") or "jev-latest"
TIMEOUT_S = 5.0

# At or above this, the dialog chooses the type for the reader. From the
# 2026-09-30 trial on 16 observations with these descriptions: every answer at
# 0.9 or more was right (7 of 16), and the one confident miss sat at 0.78.
CONFIDENT = 0.9
TOP = 3
# Below this a suggestion is noise ("Preferred languages" for batch cooking,
# at 0.00). In the same trial, where the right type was not Jev's first, it
# was still at 0.09 and 0.22, so the floor keeps it. The first always stays.
FLOOR = 0.05
NONE = "none"

INSTRUCTIONS = "Where in this person's persona does this observation about them belong?"


def enabled() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY"))


def criteria(packs: list[dict]) -> dict[str, dict]:
    """{"section.entity": criterion} over the packs given, plus `none`.

    Keyed by section as well as entity, so two packs may one day declare the
    same entity name without one hiding the other. A type without `about` is
    still offered, on its titles alone.
    """
    out: dict[str, dict] = {}
    for pack in packs:
        for target in pack.get("promotable") or []:
            about = target.get("about") or {}
            what = f"{pack['title']} › {target['title']}"
            criterion = {"what": f"{what}: {about['what']}" if about.get("what") else what}
            if about.get("not_for"):
                criterion["not_for"] = about["not_for"]
            if about.get("examples"):
                criterion["examples"] = list(about["examples"])
            out[f"{pack['key']}.{target['entity']}"] = criterion
    out[NONE] = {"what": "Nothing above fits this observation"}
    return out


def _nothing(on: bool) -> dict:
    return {"enabled": on, "suggestions": [], "confident": False}


async def suggest(observation: dict, packs: list[dict], client: httpx.AsyncClient | None = None) -> dict:
    """{enabled, suggestions: [{section, entity, probability}], confident}.

    Up to three suggestions, most likely first, never `none`, and none after
    the first below FLOOR. `confident` says
    the first is Jev's choice at CONFIDENT or above. Any failure -- no key, a
    timeout, a refusal, an answer in a shape it did not expect -- is no
    suggestions rather than an error: the dialog works as it did without them.
    """
    key = os.getenv("TYPESAFE_API_KEY")
    if not key:
        return _nothing(False)
    options = criteria(packs)
    if len(options) < 2:
        return _nothing(True)
    state = {k: observation[k] for k in ("note", "rationale", "evidence") if observation.get(k)}
    body = {
        "model": MODEL,
        "state": state,
        "questions": {"destination": {"type": "choice", "instructions": INSTRUCTIONS, "criteria": options}},
    }
    try:
        if client is None:
            async with httpx.AsyncClient(timeout=TIMEOUT_S) as own:
                response = await own.post(URL, headers={"Authorization": f"Bearer {key}"}, json=body)
        else:
            response = await client.post(URL, headers={"Authorization": f"Bearer {key}"}, json=body)
        response.raise_for_status()
        answer = response.json()["answers"]["destination"]
        ranked = sorted(answer["probabilities"].items(), key=lambda kv: -kv[1])
    except (httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError) as exc:
        logger.warning("routing: no suggestion for an observation (%s)", exc)
        return _nothing(True)

    suggestions = []
    for option, probability in ranked:
        if option not in options or option == NONE:
            continue
        if suggestions and float(probability) < FLOOR:
            break
        section, entity = option.split(".", 1)
        suggestions.append({"section": section, "entity": entity, "probability": round(float(probability), 3)})
        if len(suggestions) == TOP:
            break
    confident = (
        bool(suggestions)
        and answer.get("choice") == f"{suggestions[0]['section']}.{suggestions[0]['entity']}"
        and float(answer.get("confidence") or 0) >= CONFIDENT
    )
    return {"enabled": True, "suggestions": suggestions, "confident": confident}
