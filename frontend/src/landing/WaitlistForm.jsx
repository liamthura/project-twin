import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The waitlist field.
 *
 * Five states -- idle, invalid, submitting, done, error -- which is the state
 * machine the Figma prototype wires on desktop. It is here rather than inline
 * because the hero and the closing CTA are the same control twice, and two
 * copies would drift.
 *
 * Posts to `POST /api/waitlist`, which is public because the person filling it
 * in has no account -- that is what they are asking for. Pass `onSubmit` to
 * override.
 *
 * The server gives the same answer whether or not the address is already on
 * the list, so this cannot report "already joined" and must not try: doing so
 * would turn the form into a membership oracle.
 */
export function WaitlistForm({ label, tone = "default", align = "start", onSubmit, className }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle");
  const [message, setMessage] = useState("");
  const inverse = tone === "inverse";

  const submit = async (event) => {
    event.preventDefault();
    // Deliberately loose: the server is the real validator, and a strict
    // client-side pattern rejects addresses that are actually deliverable.
    if (!/.+@.+\..+/.test(email)) {
      setState("invalid");
      setMessage("That does not look like an email address.");
      return;
    }

    setState("submitting");
    setMessage("");
    try {
      const send =
        onSubmit ??
        (async (value) => {
          const res = await fetch("/api/waitlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: value }),
          });
          if (res.ok) return;
          // The server rejects an address it cannot use, and its reason is
          // better than anything this can guess. Anything else is ours to
          // apologise for, not the visitor's to decode.
          const detail = await res.json().catch(() => null);
          throw new Error(
            res.status === 422 && typeof detail?.detail === "string"
              ? detail.detail
              : "Something went wrong. Try again, or email liam@thuradev.qzz.io.",
          );
        });
      await send(email);
      setState("done");
      setMessage("You're on the list. We'll email you when a slot opens.");
    } catch (err) {
      setState("error");
      setMessage(
        err?.message || "Something went wrong. Try again, or email liam@thuradev.qzz.io.",
      );
    }
  };

  if (state === "done") {
    return (
      <p
        role="status"
        className={cn(
          "text-base font-medium",
          inverse ? "text-on-inverse" : "text-foreground",
          className,
        )}
      >
        {message}
      </p>
    );
  }

  const failed = state === "invalid" || state === "error";

  return (
    <form
      onSubmit={submit}
      className={cn("w-full max-w-md", align === "center" && "mx-auto", className)}
      noValidate
    >
      {/* One pill, not two controls with a gap. The aesthetic direction calls
          for pill controls on the marketing surface, and the prototype draws
          the field and its button as a single rounded unit. */}
      <div
        className={cn(
          "flex items-center rounded-full border p-1 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          inverse
            ? "border-on-inverse/15 bg-on-inverse/10 focus-within:ring-offset-ground-inverse"
            : "border-border bg-card focus-within:ring-offset-background",
          failed && "border-destructive",
        )}
      >
        <label htmlFor={id} className="sr-only">
          Email address
        </label>
        <Input
          id={id}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (failed) {
              setState("idle");
              setMessage("");
            }
          }}
          aria-invalid={failed || undefined}
          aria-describedby={message ? `${id}-message` : undefined}
          className={cn(
            // The pill owns the border and the focus ring, so the input inside
            // it has neither -- two rings on one control reads as a mistake.
            "h-10 flex-1 border-0 bg-transparent px-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            inverse && "text-on-inverse placeholder:text-on-inverse/40",
          )}
        />
        <Button
          type="submit"
          disabled={state === "submitting"}
          className="h-10 shrink-0 rounded-full px-5"
        >
          {state === "submitting" ? "Joining…" : label}
        </Button>
      </div>
      {message ? (
        <p
          id={`${id}-message`}
          role="alert"
          className={cn(
            "mt-2 text-sm",
            inverse ? "text-on-inverse/80" : "text-destructive",
          )}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
