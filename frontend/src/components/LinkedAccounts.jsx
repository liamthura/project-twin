/**
 * The identity provider, linked or not.
 *
 * Linking is always explicit and always starts from a signed-in session. The
 * auth service will not link a provider to an account by matching email --
 * `disableImplicitLinking` in auth/src/auth.js -- because the provider cannot
 * truthfully assert that an address is verified, and auto-linking on a claim
 * nobody can vouch for is a known takeover class.
 *
 * So this panel is not a convenience. It is the only way an account that
 * already exists ever gets a linked provider, which makes it the whole
 * migration path for every account that predates SSO.
 *
 * Presentational plus its two actions: AccountPanel owns the fetch, because it
 * needs the same two answers to decide whether a password change is worth
 * offering, and two components asking the same question is two answers that can
 * disagree.
 */
import { useState } from "react";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SSO_LABEL,
  SSO_PROVIDER_ID,
  startSsoLink,
  unlinkAccount,
} from "@/lib/session.js";

export function LinkedAccounts({ accounts = [], sso = false, onChanged = () => {} }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Nothing to say on an instance that federates nothing. Not a disabled
  // control: a control for a feature this instance does not have is a question
  // nobody asked.
  if (!sso) return null;

  const linked = accounts.find((a) => a.providerId === SSO_PROVIDER_ID);
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  // Better Auth refuses to unlink the last account, but the person should
  // learn that before the click rather than from a red message after it.
  const isOnlyWayIn = Boolean(linked) && !hasPassword;

  const handleLink = async () => {
    setError(null);
    setPending(true);
    try {
      // NO hash, on either URL. Better Auth validates every callback against
      // trusted-origins.mjs's relative-path rule, whose character class is
      // [\w\-.+/@] plus an optional `?query` -- a `#` is not in it, so any
      // hash-bearing path is refused outright with "Invalid callbackURL"
      // before the redirect is ever built. MyGist is hash-routed, so returning
      // someone to the exact section they started from is simply not
      // expressible here; landing on the default section is the cost.
      // Settings is a dialog with no route of its own and closes either way.
      const base = `${window.location.pathname}${window.location.search}`;
      await startSsoLink({
        callbackURL: base,
        // Same value, and doubly so for failures: Better Auth builds its error
        // redirect by string concatenation (callback.mjs:82 appends
        // `?error=<code>`), so even if a hash were accepted it would produce
        // `/#/profile?error=...` and bury the code in the fragment.
        // AccountPanel picks the code up from the query.
        errorCallbackURL: base,
      });
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
    // No `finally`: on success the browser is already leaving.
  };

  const handleUnlink = async () => {
    setError(null);
    setPending(true);
    try {
      await unlinkAccount(linked.id);
      onChanged();
    } catch (err) {
      // The service's own words. Re-implementing its rule here would be a
      // second copy of it, free to drift.
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
            {linked ? (
              <ShieldCheck className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate font-medium">
              {linked ? `${SSO_LABEL} is linked` : SSO_LABEL}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isOnlyWayIn
              ? `This is the only way to sign in to this account. Set a password first if you want to unlink it.`
              : linked
                ? `You can sign in to MyGist with ${SSO_LABEL}.`
                : `Link it and you can sign in with ${SSO_LABEL} instead of a password.`}
          </p>
        </div>

        {linked ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleUnlink}
            disabled={pending || isOnlyWayIn}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlink"}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleLink}
            disabled={pending}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Link ${SSO_LABEL}`}
          </Button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
