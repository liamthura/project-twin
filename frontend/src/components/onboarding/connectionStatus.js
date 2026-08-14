/**
 * What the Getting-started card may say about step 1.
 *
 * The card claims `waiting for first call... -> connected` for one connection
 * type and not the other, and the asymmetry is real rather than an omission:
 *
 *   Token. `tokens.last_used_at` is touched only by `db.resolve_token`, so a
 *     non-null value is genuine evidence that a client called. This gets the
 *     real waiting-then-connected moment.
 *
 *   OAuth grant. OAuth clients authenticate as Better Auth JWTs through
 *     `db.resolve_user_by_id` -- which the WEB APP ITSELF also uses -- so
 *     `users.last_seen_at` cannot distinguish a client call from the reader
 *     browsing their own persona. A grant is therefore reported connected and
 *     named, and never claimed to have made a call.
 *
 * Per-grant call tracking would close the gap and was rejected for this slice:
 * new state, a migration and a write on a hot auth path, to earn one word.
 */

// persona:write implies persona:propose -- backend/scopes.py states the
// hierarchy and expands at the edge. A stored scope set may or may not have
// been expanded already, so both spellings count.
export const PROPOSE_SCOPES = ["persona:propose", "persona:write"];

function carriesPropose(scopes) {
  return (scopes || []).some((s) => PROPOSE_SCOPES.includes(s));
}

export function connectionStatus(tokens, grants) {
  const tokenRows = tokens || [];
  const grantRows = grants || [];

  const canPropose =
    tokenRows.some((t) => carriesPropose(t?.scopes)) ||
    grantRows.some((g) => carriesPropose(g?.scopes));

  // A used token first: it is the only evidence here that a client actually
  // called, and the card's best moment is naming the thing that did.
  const used = tokenRows.find((t) => t?.last_used_at);
  if (used) return { state: "connected", name: used.label || null, canPropose };

  if (grantRows.length > 0) {
    const first = grantRows[0];
    return { state: "connected", name: first.clientName || null, canPropose };
  }

  if (tokenRows.length > 0) {
    return { state: "waiting", name: tokenRows[0].label || null, canPropose };
  }

  return { state: "none", name: null, canPropose: false };
}
