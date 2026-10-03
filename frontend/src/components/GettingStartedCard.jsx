/**
 * The spine card, on Profile. Three steps, and it ROUTES rather than collects.
 *
 * A checklist with one next step. The first step not done is the current one
 * (aria-current="step") and holds the card's only filled button; a step done
 * goes quiet, keeping only a status worth reading; a later one keeps a quiet
 * link. Four outlined buttons of equal weight used to leave the next move
 * unmarked, and a finished step kept its button. At three of three the list
 * gives way to one line saying you're set up, with a way to Review and Hide.
 *
 * Every tick is a fact, not a stored claim that could disagree with what
 * happened. Connected means watchtower saw an MCP call (backend/watchtower.py),
 * so a token nobody has used waits with a clock. The basics are done when a
 * basics field holds something. The first suggestion is ticked when the
 * assistant has made one.
 *
 * While it shows, it carries the email nudge as one quiet line, so Profile has
 * one banner and not two: App hides AddEmailBanner there while
 * `onShownChange` says true.
 *
 * Dismissing is not destructive. Nothing is deleted -- the flow is a view over
 * fields that already exist. The card comes back from Settings → Account, as
 * it was.
 */
import { useEffect, useState } from "react";
import { Check, Clock, Copy, X } from "lucide-react";

import { DISMISSED_KEY } from "@/components/AddEmailBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { showHint } from "@/lib/guide.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";
import { getSession, isPlaceholderEmail } from "@/lib/session.js";
import { cn } from "@/lib/utils";
import { atStart, useWatchtower } from "@/lib/watchtower.js";

import { AUTOFILL_PROMPT } from "./onboarding/autofillPrompt";
import { copyText } from "./onboarding/InstallCard";

// About you's fields (StepAboutYou), so "the basics" means the same thing here.
const BASICS = ["name", "preferred_name", "current_role", "organisation", "location", "bio"];

// A tick when done, a clock while waiting, else the step's number: ringed in
// the primary colour when it is the next one.
function Mark({ done, waiting, next, n }) {
  if (done) return <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
  if (waiting) return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums ring-1",
        next ? "text-primary ring-primary" : "text-muted-foreground ring-border",
      )}
    >
      {n}
    </span>
  );
}

// A later step's action: a link, underlined like the flow's other quiet links,
// so it reads as something to press without competing with the next step.
const quiet = "h-auto shrink-0 p-0 font-normal text-muted-foreground underline underline-offset-4 hover:text-foreground";

export function GettingStartedCard({
  profile, disabledSections = [], onStart, onReview, onAddEmail, onOpenSettings, onShownChange,
}) {
  const [state, setState] = useState(null);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = !!state && !state.dismissed;
  // Only while the card is on screen: a dismissed card would otherwise fetch
  // the whole connection report on every visit to Profile, to show nothing.
  const report = useWatchtower({ enabled: shown });

  useEffect(() => {
    let cancelled = false;
    getOnboarding()
      .then((saved) => !cancelled && setState(saved))
      // Hidden rather than wrong: "0 of 3" to someone who finished is a lie.
      .catch(() => !cancelled && setState({ dismissed: true, steps: {}, seen: [] }));
    if (localStorage.getItem(DISMISSED_KEY) !== "1") {
      getSession()
        .then((s) => !cancelled && setNeedsEmail(!!s?.user && isPlaceholderEmail(s.user.email)))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);
  if (!shown) return null;

  const connection = report?.connection;
  const name = connection?.name;
  const connected = connection?.state === "connected";
  const waiting = connection?.state === "waiting";
  const readOnly = connected && !connection.can_propose;
  const pending = report?.pending?.total ?? 0;

  const copyPrompt = async () => {
    // Refused by the browser, it says nothing it cannot back up.
    if (!(await copyText(AUTOFILL_PROMPT))) return;
    setCopied(true);
    showHint("hint:paste-prompt", {
      element: '[data-guide="copy-prompt"]',
      title: `Paste it into ${name || "your assistant"}`,
      description: "Your assistant reads your persona and sends its suggestions to Review.",
    });
  };

  const steps = [
    {
      label: "Connect an assistant",
      done: connected,
      waiting,
      status: connected ? atStart(name) : waiting ? `Waiting for ${name || "your assistant"}…` : null,
      // While waiting too: a token made and never pasted otherwise left no
      // way back to the steps from here.
      action: { label: "Connect", run: () => onStart("assistant") },
    },
    {
      label: "Fill in the basics",
      done: BASICS.some((k) => String(profile?.[k] ?? "").trim()),
      action: { label: "Fill in", run: () => onStart("about-you") },
    },
    {
      label: "Get a first suggestion",
      done: !!report?.assistant?.suggested,
      // mcp_scopes.py HIDES tools a connection is not scoped for, so the
      // prompt is offered only where it can work, and a read-only connection
      // is told why nothing will come.
      note: readOnly ? `${atStart(name)} can only read your persona, so it can't suggest anything.` : null,
      action: readOnly
        ? { label: "Change access", run: () => onOpenSettings?.("connections") }
        : connected
          ? { label: copied ? "Copied" : "Copy prompt", icon: copied ? Check : Copy, run: copyPrompt, guide: "copy-prompt" }
          : null,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const dismiss = () => {
    const nextState = { ...state, dismissed: true };
    setState(nextState);
    saveOnboarding(nextState, disabledSections).catch(() => {
      // The card is already gone from this page. A lost write costs one
      // reappearance on the next load, a smaller failure than an
      // undismissable card.
    });
  };

  const emailLine = needsEmail && (
    <p className="border-t pt-3 text-xs text-muted-foreground">
      No recovery email yet.{" "}
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onAddEmail}>
        Add one
      </Button>
    </p>
  );

  // Three of three: the list has done its job.
  if (!next) {
    return (
      <Card className="mb-6">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">You&apos;re set up</p>
              <p className="text-sm text-muted-foreground">
                {atStart(name)} reads your persona, and what it suggests waits in Review.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {pending > 0 && (
                <Button variant="outline" size="sm" onClick={onReview}>
                  Review {pending}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Hide
              </Button>
            </div>
          </div>
          {emailLine}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm font-medium">Getting started</p>
          {/* The same three-part bar onboarding uses; the words are for
              screen readers. */}
          <span className="sr-only">{done} of 3 done</span>
          <span className="flex gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 w-5 rounded-full transition-colors duration-300 ease-standard motion-reduce:transition-none",
                  // bg-border, not bg-muted: on the card's white, muted vanished.
                  s.done ? "bg-primary" : "bg-border",
                )}
              />
            ))}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1.5 h-7 w-7 shrink-0 text-muted-foreground"
            aria-label="Hide getting started"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ol className="space-y-1">
          {steps.map((s, i) => {
            const isNext = s === next;
            const Icon = s.action?.icon;
            return (
              <li key={s.label} aria-current={isNext ? "step" : undefined}>
                <div className="flex min-h-9 items-center gap-3 text-sm">
                  <Mark done={s.done} waiting={s.waiting} next={isNext} n={i + 1} />
                  <span className={cn("min-w-0 flex-1 truncate", isNext ? "font-medium" : "text-muted-foreground")}>
                    {s.label}
                  </span>
                  {s.status && <span className="min-w-0 truncate text-xs text-muted-foreground">{s.status}</span>}
                  {s.done && i === 2 && pending > 0 && (
                    <Button variant="link" size="sm" className={quiet} onClick={onReview}>
                      Review {pending}
                    </Button>
                  )}
                  {!s.done && s.action && (
                    <Button
                      variant={isNext ? "default" : "link"}
                      size="sm"
                      className={isNext ? "shrink-0" : quiet}
                      data-guide={s.action.guide}
                      onClick={s.action.run}
                    >
                      {Icon && isNext && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                      {s.action.label}
                    </Button>
                  )}
                </div>
                {isNext && s.note && <p className="pb-1 pl-7 text-xs text-muted-foreground">{s.note}</p>}
              </li>
            );
          })}
        </ol>
        {emailLine}
      </CardContent>
    </Card>
  );
}
