/**
 * Let your assistant fill it in: the Fill in screen on the assistant path.
 *
 * The flow used to end with "Done, my assistant will fill it in", offered
 * before anything had happened, and then send you to a form. Now the screen
 * stays until the assistant's suggestions arrive, and its one filled button
 * becomes the way to Review. That first approval is the moment the product is
 * for. The status comes from watchtower: suggestions waiting first, because a
 * returning reader may already have some, then reading, then the paste hint.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { atStart } from "@/lib/watchtower.js";

import { AUTOFILL_PROMPT } from "./autofillPrompt";
import { StatusLine } from "./StepConnect";

const suggestions = (n) => `${n} ${n === 1 ? "suggestion" : "suggestions"}`;

export function StepHandover({ client, report, onReview, onTypeMyself, onLater }) {
  const [copied, setCopied] = useState(false);
  const connection = report?.connection;
  const name =
    (connection?.state === "connected" && connection.name) || (client.kind === "other" ? null : client.name);
  const mid = name || "your assistant";
  const pending = report?.pending?.total ?? 0;
  // mcp_scopes.py HIDES tools a credential is not scoped for rather than
  // failing them, so the prompt pasted into a read-only connection does
  // nothing at all, with no error anywhere. It is not offered there.
  const readOnly = connection?.state === "connected" && !connection.can_propose;

  const status =
    pending > 0
      ? ["done", `${suggestions(pending)} waiting.`]
      : report?.assistant?.read
        ? ["waiting", `${atStart(mid)} is reading your persona…`]
        : copied
          ? ["waiting", `Paste it into ${mid}. Suggestions appear here as they arrive.`]
          : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Let {mid} fill it in</h1>
        {!readOnly && (
          <p className="max-w-prose text-muted-foreground">
            Paste this into {mid}, and it suggests what to add from what it knows about you. Nothing is saved
            until you approve it.
          </p>
        )}
      </div>

      {readOnly ? (
        <StatusLine state="warn">
          {atStart(mid)} can only read your persona, so it can't suggest anything. Reconnect it with permission
          to suggest, in Settings → Connections.
        </StatusLine>
      ) : (
        <div className="space-y-4">
          <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">{AUTOFILL_PROMPT}</p>
          {status && <StatusLine state={status[0]}>{status[1]}</StatusLine>}
          {pending > 0 ? (
            <Button onClick={onReview}>Review {suggestions(pending)}</Button>
          ) : (
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(AUTOFILL_PROMPT);
                setCopied(true);
              }}
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy prompt"}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onTypeMyself}>
          I'd rather type it myself
        </Button>
        <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onLater}>
          Finish later
        </Button>
      </div>
    </div>
  );
}
