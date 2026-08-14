/**
 * The three OAuth scopes MyGist defines, and how to say them in English.
 *
 * These were declared four times before this file existed -- in
 * ConnectionSettings, ConnectedApps, Consent and ProposalsPanel -- each with a
 * comment saying it had to match the others exactly, and one of those comments
 * naming only two of the other three. The values are checked by the auth
 * service rather than displayed, so a copy that drifted would produce a grant
 * that authenticates and then does nothing.
 *
 * Must match auth/src/oauth.js.
 */
export const READ = "persona:read";
export const PROPOSE = "persona:propose";
export const WRITE = "persona:write";

export const PERSONA_SCOPES = [READ, PROPOSE, WRITE];

/**
 * One row each, in the order a grant widens.
 *
 * No row for read: it is the floor for every grant, and both screens that use
 * this list it unconditionally rather than checking for it.
 */
export const SCOPE_LABELS = [
  [PROPOSE, "Suggest changes for your approval"],
  [WRITE, "Change your persona directly"],
];

/**
 * The same grant as one short line, for a token row with no space for three.
 *
 * Built from the scopes actually present, not from the widest one found. A
 * token minted through the settings dialog always satisfies
 * write > propose > read, but POST /api/auth/tokens does not enforce that, so
 * read + write is a real shape and must not be reported as all three.
 */
export function summariseScopes(scopes) {
  const held = new Set(scopes || []);
  if (!held.has(READ)) return "No access";
  const propose = held.has(PROPOSE);
  const write = held.has(WRITE);
  if (propose && write) return "Read, propose and change directly";
  if (write) return "Read and change directly";
  if (propose) return "Read and propose";
  return "Read only";
}
