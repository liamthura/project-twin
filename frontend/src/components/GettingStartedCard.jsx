/**
 * The spine card, on Profile. Three steps, and it ROUTES rather than collects.
 *
 * It survived the reversal that turned onboarding into a standalone flow, and
 * it survived deliberately: the flow is where the work happens, and this is
 * where someone finds their way back to it.
 *
 * Dismissing is not destructive. Nothing is deleted -- the flow is a view over
 * fields that already exist, and `#/onboarding/welcome` still works if typed.
 * The card comes back from Connection Settings.
 */
import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listConnectedApps, listTokens } from "@/lib/api.js";
import { getOnboarding, saveOnboarding } from "@/lib/onboarding.js";

import { AUTOFILL_PROMPT } from "./onboarding/autofillPrompt";
import { connectionStatus } from "./onboarding/connectionStatus";

function StepMark({ done, n }) {
  return done ? (
    <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
  ) : (
    <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{n}</span>
  );
}

export function GettingStartedCard({ disabledSections = [], onStart, onOpenSettings }) {
  const [state, setState] = useState(null);
  const [connection, setConnection] = useState({
    state: "none",
    name: null,
    canPropose: false,
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOnboarding()
      .then((saved) => {
        if (!cancelled) setState(saved);
      })
      .catch(() => {
        // A card that cannot load its own progress is better hidden than wrong:
        // showing "0 of 3" to someone who finished would be a lie.
        if (!cancelled) setState({ dismissed: true, steps: {} });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // listTokens throws for a read-scoped credential -- see its comment in
      // api.js. That is a permission, not a failure, so it degrades to "no
      // tokens I can see" rather than taking the card down.
      listTokens().catch(() => []),
      listConnectedApps().catch(() => []),
    ]).then(([tokens, grants]) => {
      if (!cancelled) setConnection(connectionStatus(tokens, grants));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.dismissed) return null;

  const connected = connection.state !== "none";
  const basicsDone = state.steps["about-you"] === "done";
  const doneCount = [connected, basicsDone].filter(Boolean).length;

  const dismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    saveOnboarding(next, disabledSections).catch(() => {
      // The card is already gone from this page. A lost write costs one
      // reappearance on the next load, which is a smaller failure than an
      // undismissable card.
    });
  };

  return (
    <Card className="mb-6">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground">{doneCount} of 3</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label="Dismiss getting started"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ol className="space-y-3">
          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <StepMark done={connected} n={1} />
              <span className="truncate">Connect a client</span>
            </span>
            {connection.state === "connected" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                connected · {connection.name || "a client"}
              </span>
            )}
            {connection.state === "waiting" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                waiting for first call…
              </span>
            )}
            {connection.state === "none" && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={onOpenSettings}
              >
                Connect
              </Button>
            )}
          </li>

          <li className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <StepMark done={basicsDone} n={2} />
              <span className="truncate">Fill in the basics</span>
            </span>
            <Button variant="outline" size="sm" onClick={onStart} className="shrink-0">
              {basicsDone ? "Review" : "Start"}
            </Button>
          </li>

          <li className="space-y-2 text-sm">
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <StepMark done={false} n={3} />
                <span className="truncate">Ask your client to fill in the rest</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">optional</span>
            </span>

            {/* The silent-failure guard. mcp_scopes.py HIDES tools a connection
                is not scoped for rather than failing them, so pasting this
                prompt into a read-only connection does nothing at all, with no
                error anywhere. Offering the button there would be offering a
                button that cannot work. */}
            {connected && !connection.canPropose && (
              <p className="pl-6 text-xs leading-relaxed text-muted-foreground">
                Your connection can only read your persona, so it cannot suggest
                anything.{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={onOpenSettings}
                >
                  Reconnect with permission to suggest
                </button>{" "}
                to use this.
              </p>
            )}

            {connected && connection.canPropose && (
              <div className="pl-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(AUTOFILL_PROMPT);
                    setCopied(true);
                  }}
                >
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy prompt"}
                </Button>
              </div>
            )}
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
