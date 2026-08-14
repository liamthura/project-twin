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
import { Field } from "@/components/ui/field";
import { resetPassword } from "@/lib/session.js";
// The minimum used to be declared here as well as in WelcomeAuth, which is two
// copies of a number the backend owns. Checked before a round trip, not instead
// of the server's own check.
import {
  MIN_PASSWORD_LENGTH,
  validatePassword,
  validateConfirmPassword,
} from "@/lib/authValidation.js";

export function ResetPassword({ token, onDone }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});

  // Both fields together, because the second one's rule is about the first.
  const checkAll = () => ({
    password: validatePassword(password, { isNew: true }),
    confirmPassword: validateConfirmPassword(confirmPassword, password),
  });

  const blur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(checkAll());
  };

  const change =
    (setter, ...fields) =>
    (e) => {
      setter(e.target.value);
      setErrors((prev) => {
        const next = { ...prev };
        for (const field of fields) delete next[field];
        return next;
      });
    };

  const shown = (field) => (touched[field] ? errors[field] : undefined);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    const found = checkAll();
    setErrors(found);
    setTouched({ password: true, confirmPassword: true });
    if (Object.values(found).some(Boolean)) return;

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
        <Field id="reset-password" label="New password" error={shown("password")}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              value={password}
              // Clears Confirm's message too: changing this field is what makes
              // a mismatch under the next one stale.
              onChange={change(setPassword, "password", "confirmPassword")}
              onBlur={blur("password")}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            />
          )}
        </Field>
        <Field
          id="reset-confirm-password"
          label="Confirm password"
          error={shown("confirmPassword")}
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={change(setConfirmPassword, "confirmPassword")}
              onBlur={blur("confirmPassword")}
              placeholder="Re-enter password"
            />
          )}
        </Field>

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
