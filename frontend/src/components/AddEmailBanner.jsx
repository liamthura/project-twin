/**
 * A nudge for accounts that have no email, which is all of them until someone
 * adds one.
 *
 * The problem it exists for is quiet: an account without a deliverable address
 * cannot have its password reset, and nobody discovers that until the day they
 * have forgotten it -- the one day nothing can be done about it. So it is worth
 * saying while it is still fixable.
 *
 * Dismissible, and the dismissal sticks. This is a prompt, not a wall: someone
 * who has decided they do not want to give MyGist an email should be able to
 * stop being asked, and the account settings still offer it whenever they
 * change their mind.
 */
import { useEffect, useState } from "react";
import { Mail, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSession, isPlaceholderEmail } from "@/lib/session.js";

const DISMISSED_KEY = "mygist_add_email_dismissed";

export function AddEmailBanner({ onAddEmail }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Read the dismissal first so a dismissed banner costs no request.
    if (localStorage.getItem(DISMISSED_KEY) === "1") return undefined;

    getSession()
      .then((session) => {
        // No session means detached mode or a plain token, neither of which
        // has an email to add. Asking there would be asking for something the
        // UI cannot then deliver.
        if (!cancelled && session?.user && isPlaceholderEmail(session.user.email)) {
          setShow(true);
        }
      })
      .catch(() => {
        // A prompt is not worth surfacing an error for.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  };

  return (
    // items-center, not items-start. The row holds a 20px line of text beside a
    // 36px `size="sm"` button, so top-aligning them puts the sentence 8px above
    // the button's own label -- close enough to look like a mistake rather than
    // a choice, which is what it was. Centring is also what every other
    // row-with-a-button in the app does (see settings/AccountPanel).
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>
          Add an email to your account so you can reset your password if you ever
          lose it.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" onClick={onAddEmail}>
          Add email
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
