/**
 * The feedback island: a pill in the bottom right of every signed-in screen
 * that opens into a short form (docs/superpowers/specs/2026-10-02-feedback-island-design.md).
 *
 * The panel grows from the pill's corner and the pill hides while it is open,
 * so the two read as one thing opening. What was typed survives closing it;
 * only a send clears it. Success is said in the panel, not a toast, because
 * onboarding has no Toaster and the island is there too.
 *
 * An error toast's Report opens it through FEEDBACK_EVENT (lib/feedback.js),
 * adding the error's words to whatever is already in the box.
 */
import { useEffect, useRef, useState } from "react";
import { ImagePlus, MessageSquare, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { segmentClass } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { FEEDBACK_EVENT, sendFeedback, shrinkImage } from "@/lib/feedback.js";
import { getSession, isPlaceholderEmail } from "@/lib/session.js";
import { cn } from "@/lib/utils";

const KINDS = [
  {
    id: "problem",
    label: "Problem",
    prompt: "What happened?",
    hint: "What you did, what you expected, and what happened instead.",
  },
  { id: "idea", label: "Idea", prompt: "What's your idea?", hint: "What it would let you do." },
  { id: "other", label: "Something else", prompt: "What's on your mind?", hint: "" },
];

const IMAGE_ERRORS = {
  unreadable: "That image couldn't be read. Try a PNG or JPEG.",
  "too-large": "That image is too large, even after shrinking. Try cropping it.",
};

export function FeedbackIsland({ onAddEmail }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("problem");
  const [message, setMessage] = useState("");
  const [shot, setShot] = useState(null); // { blob, url }
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);
  // undefined while asking, null when there is nowhere to reply.
  const [email, setEmail] = useState(undefined);
  const pill = useRef(null);
  const box = useRef(null);
  const picker = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        const address = s?.user?.email;
        if (!cancelled) setEmail(address && !isPlaceholderEmail(address) ? address : null);
      })
      .catch(() => !cancelled && setEmail(null));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onReport = (e) => {
      const said = e.detail?.message;
      setKind(e.detail?.kind || "problem");
      if (said) setMessage((m) => (m.trim() ? `${m.trimEnd()}\n\n${said}\n\n` : `${said}\n\n`));
      setStatus("idle");
      setError(null);
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_EVENT, onReport);
    return () => window.removeEventListener(FEEDBACK_EVENT, onReport);
  }, []);

  // The thumbnail's object URL goes when the screenshot is replaced or removed.
  useEffect(() => () => shot && URL.revokeObjectURL(shot.url), [shot]);

  const attach = async (file) => {
    if (!file) return;
    setError(null);
    try {
      const blob = await shrinkImage(file);
      setShot({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setError(IMAGE_ERRORS[err.message] || IMAGE_ERRORS.unreadable);
    }
  };

  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find(
      (i) => i.kind === "file" && i.type.startsWith("image/"),
    );
    if (!item) return; // Text pastes as text.
    e.preventDefault();
    attach(item.getAsFile());
  };

  const sending = status === "sending";
  const send = async () => {
    // A ref, not state: two clicks in one frame both see the old state.
    if (busy.current || !message.trim()) return;
    busy.current = true;
    setStatus("sending");
    setError(null);
    try {
      await sendFeedback({ kind, message, screenshot: shot?.blob });
      setStatus("sent");
      setMessage("");
      setShot(null);
      setKind("problem");
    } catch (err) {
      setStatus("idle");
      setError(
        err?.status === 429
          ? "That's 10 reports in the last hour. Try again later."
          : "Couldn't send. Your message is still here, so try again.",
      );
    } finally {
      busy.current = false;
    }
  };

  const onOpenChange = (next) => {
    setOpen(next);
    if (!next && status === "sent") setStatus("idle");
  };

  const current = KINDS.find((k) => k.id === kind);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={pill}
          type="button"
          className={cn(
            "feedback-island fixed z-30 flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium shadow-lg transition-[background-color,bottom] duration-200 ease-standard hover:bg-muted motion-reduce:transition-none print:hidden coarse:min-h-11",
            open && "invisible",
          )}
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          Feedback
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        // Over the pill, so the panel grows out of where it was.
        sideOffset={-(pill.current?.offsetHeight ?? 38)}
        aria-labelledby="feedback-title"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          box.current?.focus();
        }}
        className="z-30 max-h-[calc(100dvh-6rem)] w-[calc(100vw-2rem)] origin-bottom-right overflow-y-auto rounded-xl p-4 shadow-lg motion-reduce:animate-none sm:w-[380px]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="feedback-title" className="text-sm font-medium">
            Send feedback
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 h-7 w-7 text-muted-foreground"
              aria-label="Close feedback"
            >
              <X className="h-4 w-4" />
            </Button>
          </PopoverClose>
        </div>

        {status === "sent" ? (
          <p role="status" className="py-6 text-center text-sm">
            Thanks. Your feedback is in.
          </p>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div role="group" aria-label="Kind of feedback" className="flex rounded-lg bg-muted p-0.5">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={kind === k.id}
                  disabled={sending}
                  onClick={() => setKind(k.id)}
                  // Sized to their words: an equal third wrapped Something else.
                  className={cn(segmentClass(kind === k.id, false), "flex-auto whitespace-nowrap")}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="feedback-message" className="text-sm font-medium">
                {current.prompt}
              </label>
              <Textarea
                id="feedback-message"
                ref={box}
                rows={4}
                maxLength={5000}
                value={message}
                readOnly={sending}
                placeholder={current.hint}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={onPaste}
              />
            </div>

            {shot ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <img
                    src={shot.url}
                    alt="Your screenshot"
                    className="h-16 w-auto max-w-[8rem] rounded border object-cover"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Remove screenshot"
                    disabled={sending}
                    onClick={() => setShot(null)}
                  >
                    Remove
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A screenshot shows everything on your screen, so crop out anything you&apos;d rather not send.
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={sending}
                  onClick={() => picker.current?.click()}
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add a screenshot
                </Button>
                or paste one into the box
                <input
                  ref={picker}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    attach(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Sent with this report: your username, the page you&apos;re on, the MyGist version, and your browser
              and screen size. Nothing from your persona is included.
            </p>
            {email !== undefined && (
              <p className="text-xs text-muted-foreground">
                {email ? (
                  `Replies go to ${email}.`
                ) : (
                  <>
                    There&apos;s no recovery email on your account, so there&apos;s nowhere to send a reply.{" "}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      // Inline in a sentence, so exempt from the 44px touch size
                      // that otherwise broke the line in two on a phone.
                      className="h-auto p-0 align-baseline text-xs coarse:min-h-0 coarse:min-w-0"
                      onClick={() => {
                        setOpen(false);
                        onAddEmail?.();
                      }}
                    >
                      Add one
                    </Button>
                  </>
                )}
              </p>
            )}

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={sending || !message.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
