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
 * THE ENDPOINT DOES NOT EXIST YET. `POST /api/waitlist` is what this calls and
 * nothing serves it; the design spec puts "the waitlist backend endpoint and
 * storage" explicitly out of scope. Until it is built, a real submission lands
 * in the error state. Pass `onSubmit` to override.
 */
export function WaitlistForm({ label, tone = "default", onSubmit, className }) {
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
          if (!res.ok) throw new Error(`Waitlist signup failed (${res.status})`);
        });
      await send(email);
      setState("done");
      setMessage("You're on the list. We'll email you when a slot opens.");
    } catch (err) {
      setState("error");
      setMessage(
        err?.message ?? "Something went wrong. Try again, or email liam@thuradev.qzz.io.",
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
    <form onSubmit={submit} className={cn("w-full max-w-md", className)} noValidate>
      <div className="flex flex-col gap-3 sm:flex-row">
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
            "h-11 flex-1",
            inverse &&
              "border-on-inverse/20 bg-on-inverse/5 text-on-inverse placeholder:text-on-inverse/40",
          )}
        />
        <Button type="submit" size="lg" disabled={state === "submitting"}>
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
