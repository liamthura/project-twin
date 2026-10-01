/**
 * The spine card, on Profile. Three steps, and it ROUTES rather than collects.
 *
 * Every tick is a fact, not a stored claim that could disagree with what
 * happened. Connected means watchtower saw an MCP call (backend/watchtower.py),
 * so a token nobody has used waits with a clock rather than a tick. The basics
 * are done when a basics field holds something. The first suggestion is ticked
 * when the assistant has made one. The old card ticked an unused token, could
 * never tick its third step, and moved backwards when you chose the assistant.
 *
 * While it shows, it carries the email nudge, so Profile has one banner and
 * not two: App hides AddEmailBanner there while `onShownChange` says true.
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
import { atStart, useWatchtower } from "@/lib/watchtower.js";

import { AUTOFILL_PROMPT } from "./onboarding/autofillPrompt";
import { copyText } from "./onboarding/InstallCard";

// About you's fields (StepAboutYou), so "the basics" means the same thing here.
const BASICS = ["name", "preferred_name", "current_role", "organisation", "location", "bio"];

function Mark({ done, waiting, n }) {
  if (done) return <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />;
  if (waiting) return <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{n}</span>;
}

export function GettingStartedCard({
  profile, disabledSections = [], onStart, onReview, onAddEmail, onShownChange,
}) {
  const [state, setState] = useState(null);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const report = useWatchtower();

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

  const shown = !!state && !state.dismissed;
  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);
  if (!shown) return null;

  const connection = report?.connection;
  const connected = connection?.state === "connected";
  const waiting = connection?.state === "waiting";
  const basics = BASICS.some((k) => String(profile?.[k] ?? "").trim());
  const suggested = !!report?.assistant?.suggested;
  const pending = report?.pending?.total ?? 0;
  const done = [connected, basics, suggested].filter(Boolean).length;

  const dismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    saveOnboarding(next, disabledSections).catch(() => {
      // The card is already gone from this page. A lost write costs one
      // reappearance on the next load, a smaller failure than an
      // undismissable card.
    });
  };

  const row = "flex items-center justify-between gap-3 text-sm";
  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground">{done} of 3</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label="Hide getting started"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ol className="space-y-3">
          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={connected} waiting={waiting} n={1} />
              <span className="truncate">Connect an assistant</span>
            </span>
            {connected && (
              <span className="shrink-0 text-xs text-muted-foreground">{atStart(connection.name)} connected</span>
            )}
            {waiting && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Waiting for {connection.name || "your assistant"}…
              </span>
            )}
            {!connected && !waiting && (
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => onStart("assistant")}>
                Connect
              </Button>
            )}
          </li>

          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={basics} n={2} />
              <span className="truncate">Fill in the basics</span>
            </span>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => onStart("about-you")}>
              {basics ? "Edit" : "Fill in"}
            </Button>
          </li>

          <li className={row}>
            <span className="flex min-w-0 items-center gap-2">
              <Mark done={suggested} n={3} />
              <span className="truncate">Get a first suggestion</span>
            </span>
            {pending > 0 ? (
              <Button variant="outline" size="sm" className="shrink-0" onClick={onReview}>
                Review {pending}
              </Button>
            ) : connected && connection.can_propose ? (
              // mcp_scopes.py HIDES tools a connection is not scoped for, so
              // the prompt is offered only where it can work.
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                data-guide="copy-prompt"
                onClick={async () => {
                  if (!(await copyText(AUTOFILL_PROMPT))) return;
                  setCopied(true);
                  showHint("hint:paste-prompt", {
                    element: '[data-guide="copy-prompt"]',
                    title: `Paste it into ${connection.name || "your assistant"}`,
                    description: "Your assistant reads your persona and sends its suggestions to Review.",
                  });
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? "Copied" : "Copy prompt"}
              </Button>
            ) : null}
          </li>

          {needsEmail && (
            <li className={row}>
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className="w-4 shrink-0" aria-hidden="true" />
                <span>Add an email so you can reset your password</span>
              </span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={onAddEmail}>
                Add email
              </Button>
            </li>
          )}
        </ol>
      </CardContent>
    </Card>
  );
}
