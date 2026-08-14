/**
 * Connect an assistant, then choose who fills the persona in.
 *
 * This step exists because Welcome makes an offer -- "you don't have to type
 * any of it" -- that nothing then honoured. The card on Profile could tell you
 * whether a client was connected but had no way to connect one, and the app has
 * never shown the MCP endpoint anywhere at all: it hands out a token and stops,
 * leaving the reader to guess the URL it belongs in.
 *
 * Signing in comes first, and a key second. A client that signs in gets a grant
 * the reader can see and revoke by name in Connection Settings, and there is no
 * secret to paste, lose, or leave in a config file. A token is the fallback for
 * clients that cannot do that.
 *
 * Which one is even possible is an INSTANCE fact, not a preference:
 * `oauth_metadata.register()` mounts no discovery routes when AUTH_MCP_RESOURCE
 * is unset, so on an instance without it a client told to sign in follows the
 * path to a 404. `/api/instance` reports it, and this screen recommends
 * accordingly rather than recommending something that cannot work here.
 *
 * The fork at the end is the point of the whole screen. Once something is
 * connected there are two honest answers to "who fills this in", and the flow
 * asks rather than assuming.
 */
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createToken,
  docsUrl,
  getInstance,
  listConnectedApps,
  listTokens,
  mcpUrl,
} from "@/lib/api.js";

import { AUTOFILL_PROMPT } from "./autofillPrompt";
import { connectionStatus } from "./connectionStatus";

// Read plus propose, and deliberately not write. A first connection made from
// an onboarding screen should be able to SUGGEST and nothing more -- the reader
// has not seen the review queue yet, so they cannot have formed a view on
// letting a client change things unasked. persona:read is added server-side
// regardless; see db.create_token.
const FIRST_TOKEN_SCOPES = ["persona:propose"];

function CopyButton({ value, label, children }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {children && <span className="ml-1.5">{copied ? "Copied" : children}</span>}
    </Button>
  );
}

function CopyRow({ id, label, value, hint }) {
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
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * A link into the documentation site for the per-client detail this screen
 * cannot hold: where the setting lives in each application, and what to do when
 * a connection does not take.
 *
 * Opens in a new tab, and not merely as a courtesy. A freshly minted key is
 * shown ONCE -- navigating away from this screen loses it for good, and the
 * reader would have no way of knowing that before clicking.
 *
 * `flex w-fit`, not `inline-flex`. An inline-level box sits on the same line as
 * the inline-level button before it, and JSX strips the newline between them --
 * so the two rendered touching, and the parent's `space-y` could not separate
 * them because vertical margins only push apart block-level siblings. `w-fit`
 * keeps the underline the width of the words rather than the whole row.
 */
function DocsLink({ path, children }) {
  return (
    <a
      href={docsUrl(path)}
      target="_blank"
      rel="noreferrer"
      className="flex w-fit items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

// Numbered rather than prose, because this is a procedure someone carries out
// in another application with this screen still open beside it.
function Steps({ items }) {
  return (
    <ol className="space-y-2 text-sm">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {i + 1}
          </span>
          <span className="leading-relaxed text-muted-foreground">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function StepConnect({ onDelegate, onFillManually }) {
  const [connection, setConnection] = useState(null);
  const [oauthAvailable, setOauthAvailable] = useState(false);
  const [token, setToken] = useState(null);
  const [showKeyPath, setShowKeyPath] = useState(false);
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
      getInstance(),
    ]).then(([tokens, grants, instance]) => {
      if (cancelled) return;
      setConnection(connectionStatus(tokens, grants));
      setOauthAvailable(!!instance?.mcp_oauth);
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
  const address = mcpUrl();
  // Nothing connected yet, and this instance can do the better method. Once
  // something IS connected the recommendation has been acted on, and repeating
  // it would be instructions for a job already done.
  const recommendOauth = oauthAvailable && !connected;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Connect an assistant
        </h1>
        <p className="text-muted-foreground">
          Point an AI client at MyGist and it can read your persona, and suggest
          additions for you to approve.
        </p>
      </div>

      {recommendOauth && (
        <div className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Add it to your client</p>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                recommended
              </span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your client sends you here to sign in, so there is no key to copy
              or keep safe. You can see it by name and disconnect it whenever
              you like.
            </p>
          </div>

          <Steps
            items={[
              "Copy the address below.",
              "In your client, add a custom MCP connector and paste it in. In Claude that is Settings, then Connectors, then Add custom connector.",
              "Your client opens MyGist and asks you to sign in.",
              "Approve the connection. Choose the option that lets it suggest changes.",
            ]}
          />

          <CopyRow
            id="onboarding-mcp-url"
            label="Server address"
            value={address}
          />

          <DocsLink path="/use/clients/#connecting-over-oauth">
            Need help connecting?
          </DocsLink>
        </div>
      )}

      {/* The key path. Second where signing in works, and the only path where
          it does not -- a client that cannot sign in still needs to connect. */}
      {!connected && !token && (
        <div className="space-y-4">
          {recommendOauth && !showKeyPath && (
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              onClick={() => setShowKeyPath(true)}
            >
              My client can't sign in. Use a key instead
            </button>
          )}

          {(!recommendOauth || showKeyPath) && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Connect with a key</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {oauthAvailable
                    ? "For clients that only accept a server address and a token."
                    : "This server does not offer sign-in for clients, so a key is how you connect."}
                </p>
              </div>

              <Steps
                items={[
                  "Create a key below. It can read your persona and suggest changes, and cannot change anything without your approval.",
                  "In your client, add an MCP server with the address shown.",
                  "Paste the key in as the bearer token, or as the Authorization header.",
                ]}
              />

              <Button onClick={generate} disabled={generating}>
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Create a key"
                )}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}

              <DocsLink path="/use/clients/#using-a-token-instead">
                Need help connecting?
              </DocsLink>
            </div>
          )}
        </div>
      )}

      {token && (
        <div className="space-y-4 rounded-lg border p-4">
          <CopyRow
            id="onboarding-mcp-url-key"
            label="Server address"
            value={address}
            hint="Your client asks for this as an MCP server URL."
          />
          <CopyRow
            id="onboarding-mcp-token"
            label="Key"
            value={token}
            hint="Shown once. Copy it into your client now, or make another later from Connection Settings."
          />

          {/* Repeated here rather than left behind in the block above: that
              block is gone by the time this one appears, and this is the moment
              someone actually needs to know where the key goes. */}
          <DocsLink path="/use/clients/#using-a-token-instead">
            Need help connecting?
          </DocsLink>
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
                Done, my assistant will fill it in
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

        <Button
          variant={connection.canPropose ? "ghost" : "default"}
          onClick={onFillManually}
        >
          I'll fill it in myself
        </Button>
      </div>
    </div>
  );
}
