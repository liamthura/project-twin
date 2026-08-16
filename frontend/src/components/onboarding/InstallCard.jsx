/**
 * How to install MyGist in one named client.
 *
 * Three kinds, because installing genuinely is three different gestures and
 * only one of them is a click. See `lib/clients.js` for why `kind` lives in the
 * roster rather than here.
 *
 * The copy control is the point of the whole card. Everything else on screen is
 * context for the one string someone came to take away, so each kind ends in
 * something copyable: the command, the deeplink, or the address.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AnimatedSpan, Terminal } from "@/components/ui/terminal";

// Two seconds, then back to the real label. Without this a card left open
// says "Copied" forever, and the picker shows several of these at once -- copy
// Claude Code's command, then Cursor's link, and Claude Code's button would
// still claim a copy nobody just made.
//
// Exported so StepConnect's own copy-with-a-timeout button reuses the same
// number rather than carrying a second one that could drift from it.
export const COPIED_RESET_MS = 2000;

function CopyButton({ value, label, children, variant = "outline" }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef(null);

  // The card that owns this button can close mid countdown -- a client picker
  // collapsing a row, say -- and the timeout must not then call setState on a
  // component that is no longer mounted.
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  // WCAG 2.5.3 Label in Name governs a control that HAS a visible text label:
  // the accessible name must track it, or a screen reader keeps announcing
  // "Copy X" over a button that now reads "Copied". A childless button has no
  // visible text at all -- aria-label IS its only content -- so tracking here
  // would replace the one thing distinguishing it from every other icon-only
  // copy button on screen with a generic "Copied" that never resets.
  const accessibleLabel = copied && children ? "Copied" : label;

  return (
    <Button
      variant={variant}
      size="sm"
      className="shrink-0"
      aria-label={accessibleLabel}
      onClick={() => {
        navigator.clipboard?.writeText(value);
        setCopied(true);
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {children && <span className="ml-1.5">{copied ? "Copied" : children}</span>}
    </Button>
  );
}

/**
 * The server address, shown and copyable.
 *
 * `<output>` rather than a read-only input: it is a value the page produced,
 * not a field anyone edits, and `select-all` makes a click take the whole
 * string rather than a word of it.
 */
function AddressRow({ id, url }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Server address</Label>
      <div className="flex gap-2">
        <output
          id={id}
          className="min-w-0 flex-1 select-all break-all rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs"
        >
          {url}
        </output>
        <CopyButton value={url} label="Copy server address" />
      </div>
    </div>
  );
}

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

export function InstallCard({ client, url }) {
  const payload = client.install(url);
  if (!payload || payload.length === 0) return null;

  if (client.kind === "deeplink") {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          This opens {client.name} and adds MyGist for you. Sign in when it asks,
          and keep the permission to suggest changes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href={payload}>
              Add to {client.name}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
          {/* Some browsers refuse to hand a custom scheme to an application
              without a user gesture they recognise, and say nothing when they
              do. The raw link is the way out of that. */}
          <CopyButton value={payload} label="Copy link" variant="ghost">
            Copy link
          </CopyButton>
        </div>
      </div>
    );
  }

  if (client.kind === "command") {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Run this, then sign in when {client.name} opens MyGist in your browser.
        </p>
        <Terminal title={client.name}>
          {payload.map((line, i) => (
            <AnimatedSpan key={line} delay={i * 60} className="text-foreground">
              {line}
            </AnimatedSpan>
          ))}
        </Terminal>
        {/* One copy for every line. Two buttons on a two-line command reads as
            a choice, and there is no case for taking only half of it. */}
        <CopyButton value={payload.join("\n")} label="Copy command">
          Copy command
        </CopyButton>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Steps items={payload} />
      <AddressRow id={`install-address-${client.id}`} url={url} />
    </div>
  );
}
