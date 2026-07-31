/**
 * Connected applications -- the other half of the consent screen.
 *
 * Consent.jsx hands out access; this is where it comes back. That is why it
 * ships in the same feature rather than "later": access you can see but
 * cannot withdraw is the part that ages badly.
 *
 * Revoking here deletes the underlying OAuth consent, which kills the
 * refresh token immediately -- the client cannot mint a new access token
 * after this. But an access token already issued and in flight is a signed
 * artifact the auth service does not track, so it keeps working until it
 * expires on its own (up to ten minutes). That has to be said plainly, not
 * implied away: "revoked" reading as an instant cutoff when it isn't is
 * exactly the kind of gap that erodes trust in the control.
 *
 * Presentational only: `grants` and `onRevoke` are handed in as props so
 * this can be rendered and asserted on without a network (see
 * ConnectedApps.test.jsx). ConnectionSettings.jsx is what actually calls
 * listConnectedApps()/revokeConnectedApp() and wires this up to the API.
 *
 * `grants` is the already-normalised shape ConnectionSettings produces from
 * GET /oauth2/get-consents (which returns bare consent rows -- id, clientId,
 * scopes, createdAt -- with no client name or last-used time of its own):
 *   { id, clientName, scopes: string[], lastUsedAt?: string | null }
 */
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

// Must match auth/src/oauth.js and Consent.jsx's wording exactly -- these
// are the wire values, and the labels below are what the consent screen
// used for the same three scopes.
const READ = "persona:read";
const PROPOSE = "persona:propose";
const WRITE = "persona:write";

// Read is the floor for every grant (Consent.jsx never lets it be declined),
// so it is listed unconditionally rather than checked against `scopes`.
const SCOPE_LABELS = [
  [PROPOSE, "Suggest changes for your approval"],
  [WRITE, "Change your persona directly"],
];

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export default function ConnectedApps({ grants, onRevoke }) {
  const [confirmId, setConfirmId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);

  const handleRevoke = async (id) => {
    setRevokingId(id);
    try {
      await onRevoke(id);
      setConfirmId(null);
    } catch {
      // The caller (ConnectionSettings.jsx) already surfaced this -- a
      // toast, typically. Swallowed here only so a failed revoke doesn't
      // become an unhandled rejection; skipping setConfirmId(null) above is
      // what actually matters, since it's what keeps this row in confirm
      // mode instead of collapsing as though the revoke had gone through.
    } finally {
      setRevokingId(null);
    }
  };

  if (grants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No applications are connected to your account.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border divide-y">
        {grants.map((grant) => {
          const granted = grant.scopes || [];
          const lastUsed = formatDate(grant.lastUsedAt);
          return (
            <div key={grant.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">{grant.clientName}</p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  <li>Read your persona</li>
                  {SCOPE_LABELS.filter(([scope]) => granted.includes(scope)).map(
                    ([scope, label]) => (
                      <li key={scope}>{label}</li>
                    ),
                  )}
                </ul>
                {lastUsed && (
                  <p className="text-xs text-muted-foreground">Last used {lastUsed}</p>
                )}
              </div>
              {confirmId === grant.id ? (
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleRevoke(grant.id)}
                      disabled={revokingId === grant.id}
                    >
                      {revokingId === grant.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Revoke access"
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setConfirmId(null)}
                      disabled={revokingId === grant.id}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmId(grant.id)}
                  title="Revoke access"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {/* Not decoration -- this is the one thing this screen must not get
          wrong. See the module comment: the refresh token dies now, but an
          access token already handed out is not revoked with it. */}
      <p className="text-xs text-muted-foreground">
        Revoking ends a connection&apos;s ability to get new access right away.
        A request already in progress can keep working for up to 10 minutes,
        since its access token stays valid until it expires on its own.
      </p>
    </div>
  );
}
