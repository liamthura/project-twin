/**
 * Connect the assistant you chose: the second Connect screen.
 *
 * One assistant, full width, then a status line that follows it. The line is
 * watchtower's (backend/watchtower.py): connected means an MCP call was seen,
 * so signing in from another window is noticed here without a reload, and a
 * connection that can only read says so. Before this, Connect loaded once and
 * never checked again.
 *
 * Something else holds the two routes the list cannot: a prompt for an
 * assistant that can add a server itself, and a token for one that cannot sign
 * in. The token's three steps stay beside it once it is shown, because that is
 * the moment someone needs to know where it goes, and an existing token no
 * longer hides the sign-in steps (the old screen did, everywhere). An instance
 * without assistant sign-in (AUTH_MCP_RESOURCE unset, so /api/instance says
 * mcp_oauth: false) has only the token route.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createToken, docsUrl, getInstance, mcpUrl } from "@/lib/api.js";
import { startTour } from "@/lib/guide.js";
import { cn } from "@/lib/utils";
import { atStart } from "@/lib/watchtower.js";

import { AddressRow, CopyButton, InstallCard, Steps } from "./InstallCard";
import { installPrompt } from "./installPrompt";

// Suggest, and not write. A first connection made from here should be able to
// propose and nothing more: the reader has not seen the review queue yet.
// persona:read is added server-side regardless; see db.create_token.
const FIRST_TOKEN_SCOPES = ["persona:propose"];

const TOKEN_STEPS = [
  "Create a token. It can read your persona and suggest changes, and it cannot change anything without your approval.",
  "In your assistant, add an MCP server with the address below.",
  "Paste the token where it asks for one. Some assistants call it an API key.",
];

const ICON = { done: Check, waiting: Loader2, warn: AlertTriangle };

/** One line that says where things stand, and fades when it changes. */
export function StatusLine({ state, children }) {
  const Icon = ICON[state];
  return (
    <p role="status" className="flex items-start gap-2 text-sm">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          state === "done" && "text-success",
          state === "waiting" && "animate-spin text-muted-foreground motion-reduce:animate-none",
          state === "warn" && "text-warning",
        )}
      />
      <span key={String(children)} className="animate-in fade-in duration-200 motion-reduce:animate-none">
        {children}
      </span>
    </p>
  );
}

function CopyRow({ id, label, value }) {
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
        <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
    </div>
  );
}

export function StepConnect({ client, report, onBack, onContinue }) {
  const [tokenOnly, setTokenOnly] = useState(null);
  const [wantsToken, setWantsToken] = useState(false);
  const [token, setToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getInstance()
      .then((i) => !cancelled && setTokenOnly(!i?.mcp_oauth))
      .catch(() => !cancelled && setTokenOnly(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    startTour("guide:token", [
      {
        element: '[data-guide="token"]',
        // Above the token: below it sat on top of the "shown once" warning.
        popover: {
          title: "Copy the token now",
          description: "It's shown once. Paste it into your assistant before you continue.",
          side: "top",
          align: "start",
        },
      },
    ]);
  }, [token]);

  if (tokenOnly === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  const other = client.kind === "other";
  const chosen = other ? null : client.name;
  const address = mcpUrl();
  const connection = report?.connection;
  // `assistant` is since-filtered (OnboardingFlow): a call after you chose
  // this assistant. The connection is the account's, whatever called, so it
  // says what the account may do, but never names Something else: the newest
  // connection may be an older assistant.
  const connected = !!report?.assistant?.called;
  const name = chosen;
  const tokenRoute = tokenOnly || (other && wantsToken);
  // On the token route the status waits until the token has gone where it is
  // needed; a "waiting" line under a token nobody has copied yet is noise.
  const showStatus = connected || !tokenRoute || copied;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      // Named for the assistant it is for, as Settings lists it.
      setToken((await createToken(chosen || "my assistant", FIRST_TOKEN_SCOPES)).token);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {other ? "Connect your assistant" : `Connect ${chosen}`}
      </h1>

      {!tokenRoute && !other && <InstallCard client={client} url={address} />}

      {!tokenRoute && other && (
        <div className="space-y-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            If your assistant can add an MCP server, paste this into it and it sets MyGist up itself.
          </p>
          <p className="rounded-md bg-muted p-3 text-sm leading-relaxed">{installPrompt(address)}</p>
          <CopyButton value={installPrompt(address)} label="Copy prompt" variant="default">
            Copy prompt
          </CopyButton>
        </div>
      )}

      {other && !tokenOnly && (
        <button
          type="button"
          aria-expanded={wantsToken}
          className="tap-target text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => setWantsToken((v) => !v)}
        >
          My assistant needs a token
        </button>
      )}

      {tokenRoute && (
        <div className="space-y-4">
          <Steps items={TOKEN_STEPS} />
          {!token ? (
            <>
              <Button onClick={generate} disabled={generating} aria-label={generating ? "Creating a token" : undefined}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Create a token"}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <AddressRow id="onboarding-address" url={address} />
              <div data-guide="token">
                <CopyRow id="onboarding-token" label="Token" value={token} />
              </div>
              <div role="note" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <div>
                  <p className="font-medium">Copy the token now</p>
                  <p className="text-muted-foreground">
                    It's shown once. If you lose it, create another in Settings → Connections.
                  </p>
                </div>
              </div>
              {!copied && <Button onClick={() => setCopied(true)}>I've copied it</Button>}
            </>
          )}
        </div>
      )}

      {showStatus &&
        (connected && connection?.can_propose ? (
          <StatusLine state="done">{atStart(name)} is connected.</StatusLine>
        ) : connected ? (
          <StatusLine state="warn">
            {atStart(name)} is connected, but it can only read. Reconnect it and keep "Suggest changes for your
            approval" ticked.
          </StatusLine>
        ) : (
          <StatusLine state="waiting">Waiting for {name || "your assistant"} to connect…</StatusLine>
        ))}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button variant="ghost" className="-ml-3" onClick={onBack}>
          Back
        </Button>
        {connected ? (
          <Button onClick={onContinue}>Continue</Button>
        ) : (
          <Button variant="link" className="tap-target h-auto p-0 text-muted-foreground" onClick={onContinue}>
            Continue without waiting
          </Button>
        )}
      </div>

      {/* A new tab: a token is shown once, and leaving this screen loses it. */}
      <a
        href={docsUrl(tokenRoute ? "/use/clients/#connecting-with-a-token" : "/use/clients/#connecting-over-oauth")}
        target="_blank"
        rel="noreferrer"
        className="tap-target flex w-fit items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Need help connecting {name || "your assistant"}?
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
}
