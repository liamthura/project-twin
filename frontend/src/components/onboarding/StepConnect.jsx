/**
 * Connect an assistant, then choose who fills the persona in.
 *
 * This step exists because Welcome makes an offer -- "you don't have to type
 * any of it" -- that nothing then honoured. The card on Profile could tell you
 * whether a client was connected but had no way to connect one, and the app has
 * never shown the MCP endpoint anywhere at all: it hands out a token and stops,
 * leaving the reader to guess the URL it belongs in.
 *
 * The fork at the end is the point of the whole screen. Once something is
 * connected there are two honest answers to "who fills this in", and the flow
 * asks rather than assuming: hand it to the assistant, or carry on typing.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createToken, listConnectedApps, listTokens, mcpUrl } from "@/lib/api.js";

import { AUTOFILL_PROMPT } from "./autofillPrompt";
import { connectionStatus } from "./connectionStatus";

// Read plus propose, and deliberately not write. A first connection made from
// an onboarding screen should be able to SUGGEST and nothing more -- the reader
// has not seen the review queue yet, so they cannot have formed a view on
// letting a client change things unasked. persona:read is added server-side
// regardless; see db.create_token.
const FIRST_TOKEN_SCOPES = ["persona:propose"];

function CopyRow({ id, label, value, hint }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <output
          id={id}
          className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs"
        >
          {value}
        </output>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
          }}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function StepConnect({ onDelegate, onFillManually }) {
  const [connection, setConnection] = useState(null);
  const [token, setToken] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      // Both throw for a read-scoped credential -- a permission, not a failure.
      // An empty list is the honest reading of "nothing I am allowed to see".
      listTokens().catch(() => []),
      listConnectedApps().catch(() => []),
    ]).then(([tokens, grants]) => {
      if (!cancelled) setConnection(connectionStatus(tokens, grants));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const created = await createToken("my assistant", FIRST_TOKEN_SCOPES);
      setToken(created.token);
      // A token that exists but has never been called is exactly `waiting`, and
      // it can propose because that is what we just asked for. Set here rather
      // than refetched: the list endpoint would say the same thing one round
      // trip later, and this screen has a decision waiting on the answer.
      setConnection({ state: "waiting", name: "my assistant", canPropose: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  if (connection === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const connected = connection.state !== "none";

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect an assistant
        </h1>
        <p className="text-muted-foreground">
          Give an AI client an address and a key, and it can read your persona —
          and suggest additions for you to approve.
        </p>
      </div>

      {!connected && !token && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Create a key for your assistant</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              It will be able to read your persona and suggest changes. It cannot
              change anything without your approval.
            </p>
          </div>
          <Button onClick={generate} disabled={generating}>
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Create a key"
            )}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {token && (
        <div className="space-y-4 rounded-lg border p-4">
          <CopyRow
            id="onboarding-mcp-url"
            label="Server address"
            value={mcpUrl()}
            hint="Your client asks for this as an MCP server URL."
          />
          <CopyRow
            id="onboarding-mcp-token"
            label="Key"
            value={token}
            hint="Shown once. Copy it into your client now, or make another later from Connection Settings."
          />
        </div>
      )}

      {connected && !token && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
          <Check className="h-4 w-4 shrink-0 text-success" />
          <span>
            {connection.state === "connected"
              ? `Connected · ${connection.name || "a client"}`
              : `${connection.name || "A client"} is set up, waiting for its first call.`}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium">Who fills it in?</p>

        {/* The delegate half of the fork. Offered only where a connection can
            actually propose, because mcp_scopes.py HIDES tools a credential is
            not scoped for rather than failing them -- so pasting this into a
            read-only connection does nothing at all, with no error anywhere.
            Offering it there would be offering a button that cannot work. */}
        {connection.canPropose ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Let your assistant do it</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Paste this into your assistant. Whatever it suggests waits for
                  you in Review, and nothing is saved until you approve it.
                </p>
              </div>
            </div>
            <p className="rounded-md border bg-muted/50 p-3 text-xs leading-relaxed">
              {AUTOFILL_PROMPT}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(AUTOFILL_PROMPT);
                  setPromptCopied(true);
                }}
              >
                {promptCopied ? (
                  <Check className="mr-1.5 h-4 w-4" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" />
                )}
                {promptCopied ? "Copied" : "Copy prompt"}
              </Button>
              <Button variant="ghost" onClick={onDelegate}>
                Done — my assistant will fill it in
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border p-4 text-xs leading-relaxed text-muted-foreground">
            {connected
              ? "Your connection can only read your persona, so it cannot suggest anything. Reconnect it with permission to suggest, from Connection Settings, to hand this over."
              : "Connect an assistant above and you can hand this over to it instead of typing."}
          </p>
        )}

        <Button variant={connection.canPropose ? "ghost" : "default"} onClick={onFillManually}>
          I'll fill it in myself
        </Button>
      </div>
    </div>
  );
}
