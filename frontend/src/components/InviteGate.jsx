/**
 * Step one of sign-up while MyGist is in closed testing: the invite code.
 *
 * **This is a screen, not the gate.** The code it accepts can be spent in the
 * seconds before a password is chosen, so the service checks again at sign-up
 * and that check is what actually protects anything. What this buys is failing
 * fast -- nobody fills in a whole form to be told at the end that their code
 * was wrong -- and setting the expectation before asking for anything.
 *
 * The cost is `/auth/invite/check`, which answers whether a code is valid and
 * is therefore an enumeration oracle that would not otherwise exist. Bounded by
 * the alphabet: eight characters from thirty-two is about 1.1e12, so a guesser
 * at a hundred a second is looking at years for a single hit against a hundred
 * live codes, with rate limiting on top.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  INVITE_ALPHABET,
  INVITE_LENGTH,
  checkInvite,
  formatInvite,
  isCompleteInvite,
  normaliseInvite,
} from "@/lib/session.js";

// Handed to input-otp, which filters keystrokes against it -- but `*` matches
// the empty string and the expression is used unanchored, so in practice this
// admits everything. `normaliseInvite` in onChange is what actually drops a
// typed `O` or `I`, and it covers paste and the invite link too, which a
// keystroke filter never would.
//
// Left unanchored deliberately. `^[...]$` would make the filter real and would
// then reject the first lowercase keystroke, breaking the promise printed under
// the field that case does not matter.
const PATTERN = `[${INVITE_ALPHABET}]*`;

export function InviteGate({ initialCode, onAccepted, onBack }) {
  const [code, setCode] = useState(() => normaliseInvite(initialCode));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // An invite LINK should not make anyone look at this screen: validate in the
  // background and hand straight over. Only somebody who arrived without one
  // sees the form at all.
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (autoSubmitted.current) return;
    if (!isCompleteInvite(initialCode)) return;

    autoSubmitted.current = true;
    submit(normaliseInvite(initialCode));
    // submit is stable for this purpose: it closes over nothing that changes
    // before the first run, and the ref guarantees exactly one attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  async function submit(value) {
    setError(null);

    // Checked here so a short or mistyped code costs neither a round trip nor
    // a rate-limit token.
    if (!isCompleteInvite(value)) {
      setError(`An invite code is ${INVITE_LENGTH} characters.`);
      return;
    }

    setPending(true);
    try {
      if (await checkInvite(value)) {
        onAccepted(formatInvite(value));
      } else {
        // One message for every way a code can fail. Naming which one would
        // tell a guesser where to keep looking.
        setError("That invite code isn't valid.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    submit(code);
  };

  return (
    <div className="w-full space-y-4 text-left">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="invite-code" className="text-xs font-medium">
            Invite code
          </Label>

          <InputOTP
            id="invite-code"
            maxLength={INVITE_LENGTH}
            pattern={PATTERN}
            // input-otp defaults this to "numeric", which is right for the
            // one-time codes it was written for and wrong here: two thirds of
            // the invite alphabet is letters, so a phone raises the number pad
            // and the code cannot be typed at all. Invisible on a desktop,
            // where every keyboard has everything.
            inputMode="text"
            // The alphabet is uppercase, and normaliseInvite would fix the case
            // anyway -- but a keyboard that shows the case it will produce is
            // less unnerving than one whose letters arrive changed.
            autoCapitalize="characters"
            value={code}
            onChange={(value) => {
              setCode(normaliseInvite(value));
              setError(null);
            }}
            // Enter is natural once the last slot is filled, and waiting for a
            // deliberate button press after that is friction with no purpose.
            onComplete={(value) => submit(value)}
            disabled={pending}
            aria-describedby="invite-code-help"
          >
            <InputOTPGroup>
              {[0, 1, 2, 3].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
            <InputOTPSeparator />
            <InputOTPGroup>
              {[4, 5, 6, 7].map((i) => (
                <InputOTPSlot key={i} index={i} />
              ))}
            </InputOTPGroup>
          </InputOTP>

          <p id="invite-code-help" className="text-xs text-muted-foreground">
            MyGist is in closed testing. Paste the code from your invite — case
            and the dash do not matter.
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <button type="button" onClick={onBack} className="underline hover:text-foreground">
          Sign in
        </button>
      </p>
    </div>
  );
}

/** Shown above the account form once a code has been accepted, so it is clear
 *  which one is about to be spent. */
export function AcceptedInvite({ code, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <span className="flex min-w-0 items-center gap-2">
        <Ticket className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          Invite <strong className="font-mono">{code}</strong>
        </span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 underline hover:text-foreground"
      >
        Change
      </button>
    </div>
  );
}
