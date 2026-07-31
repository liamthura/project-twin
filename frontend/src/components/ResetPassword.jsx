/**
 * Choose a new password, from the link in a reset email.
 *
 * Reached only with a token in the URL. Better Auth's emailed link goes to its
 * own /auth/reset-password/<token> first, which checks the token is real and
 * unexpired and only then redirects here -- so by the time this renders the
 * token has already been vetted once. It is still sent back for the actual
 * reset, where it is consumed single-use.
 *
 * Deliberately does NOT sign anyone in on success. The service revokes every
 * session as the password changes, which is the point of a reset; signing this
 * one back in would quietly re-open the thing that was just closed.
 */
import { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";

import { AuthShell } from "@/components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "@/lib/session.js";

// Matches MIN_PASSWORD_LENGTH in backend/main.py and Better Auth's own
// minimum. Checked here so the failure arrives before a round trip, not
// instead of the server's check.
const MIN_PASSWORD_LENGTH = 8;

export function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setPending(true);
    try {
      await resetPassword(password, token);
      setDone(true);
    } catch (err) {
      // Covers the expired and already-used cases, which the service reports
      // as an invalid token. Both mean the same thing to the person holding
      // the link: ask for another one.
      setFormError(err.message);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <AuthShell
        title="Password changed"
        description="Every device that was signed in has been signed out. Sign in again with your new password."
      >
        <div className="space-y-4">
          <CheckCircle2 className="mx-auto h-8 w-8 text-success" aria-hidden="true" />
          <Button className="w-full" onClick={onDone}>
            Sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="This link works once. Pick something you have not used here before."
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-left" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="reset-password" className="text-xs font-medium">
            New password
          </Label>
          <Input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reset-confirm-password" className="text-xs font-medium">
            Confirm password
          </Label>
          <Input
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
          />
        </div>

        {formError && <p className="text-xs text-destructive">{formError}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set new password"}
        </Button>
      </form>

      <button
        type="button"
        onClick={onDone}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        Back to sign in
      </button>
    </AuthShell>
  );
}
