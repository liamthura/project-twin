/**
 * The account's email: add one, change one, or re-send its verification.
 *
 * Every account that existed before Better Auth was seeded with
 * <username>@mygist.invalid, because the service requires an address and MyGist
 * had never asked for one. So "add an email" and "change my email" are the same
 * operation, and the only difference visible here is whether the address on
 * file is a placeholder -- which must never be shown to anyone as if it were
 * theirs, and never offered as somewhere mail could go.
 *
 * Its own component rather than more of AccountPanel: this needs its own fetch,
 * its own three states and its own error surface.
 */
import { useEffect, useState, useCallback } from "react";
import { Loader2, Mail, MailCheck, MailWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSession,
  changeEmail,
  sendVerificationEmail,
  isPlaceholderEmail,
} from "@/lib/session.js";

export function EmailSettings() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    // A null session is not an error here: detached mode signs in with a token
    // and has no Better Auth session at all, and this simply has nothing to
    // show for it.
    const session = await getSession().catch(() => null);
    setUser(session?.user ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading account email...
      </div>
    );
  }

  if (!user) return null;

  const placeholder = isPlaceholderEmail(user.email);
  const verified = !placeholder && user.emailVerified;

  const startEditing = () => {
    // Never prefill a placeholder: it is not the user's address and editing it
    // into a real one would mean deleting someone else's text.
    setDraft(placeholder ? "" : user.email || "");
    setEditing(true);
    setError(null);
    setNotice(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const next = draft.trim();
    if (!next) {
      setError("Enter an email address.");
      return;
    }
    if (next.toLowerCase() === (user.email || "").toLowerCase()) {
      setEditing(false);
      return;
    }

    setPending(true);
    try {
      await changeEmail(next);
      await load();
      setEditing(false);
      setNotice(
        verified
          ? `Check ${user.email} — we sent a link there to approve the change.`
          : `Saved. Check ${next} for a link to confirm it.`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await sendVerificationEmail(user.email);
      setNotice(`Sent again to ${user.email}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 text-sm">
            {verified ? (
              <MailCheck className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : placeholder ? (
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <MailWarning className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            )}
            {placeholder ? (
              <span className="text-muted-foreground">No email added</span>
            ) : (
              <span className="truncate font-medium">{user.email}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {placeholder
              ? "Without one, a forgotten password cannot be reset."
              : verified
                ? "Verified. You can reset your password with this address."
                : "Not verified yet — it cannot reset your password until it is."}
          </p>
        </div>

        {!editing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            {placeholder ? "Add email" : "Change"}
          </Button>
        )}
      </div>

      {editing && (
        <form onSubmit={handleSave} className="space-y-2 pt-1" noValidate>
          <Label htmlFor="account-email" className="text-xs font-medium">
            Email address
          </Label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="you@example.com"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {!editing && !placeholder && !verified && (
        <Button variant="ghost" size="sm" onClick={handleResend} disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Re-send verification email"
          )}
        </Button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}
