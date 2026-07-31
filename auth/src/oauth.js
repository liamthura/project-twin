/**
 * MyGist as an OAuth 2.1 authorization server.
 *
 * This is what lets an MCP client connect by signing in and consenting instead
 * of being handed a token to paste into a config file. Opaque tokens are not
 * replaced by it: OAuth is how an application connects, a token is how you
 * script, and both are permanent.
 *
 * Split from auth.js because that file is already the length it wants to be,
 * and because everything here is one decision -- the OAuth surface -- that can
 * be read without the email flows and the invite gate around it.
 */
import { oauthProvider } from "@better-auth/oauth-provider";

export const READ = "persona:read";
export const PROPOSE = "persona:propose";
export const WRITE = "persona:write";

/** Offered on the consent screen, in the order shown there. */
export const SCOPES = [READ, PROPOSE, WRITE];

/**
 * The canonical URI of the MCP endpoint, per RFC 8707 and RFC 9728.
 *
 * The trailing slash is stripped deliberately: the MCP specification says
 * implementations SHOULD use the form without one, and an audience is compared
 * by exact string, so `https://host/mcp/` and `https://host/mcp` are two
 * different resources to every client that follows the rule.
 */
export const MCP_RESOURCE = (publicOrigin) =>
  `${publicOrigin.replace(/\/+$/, "")}/mcp`;

/**
 * The plugin's options, exported separately so they can be asserted on.
 *
 * @param {string} baseURL Better Auth's own EFFECTIVE base -- what
 *   `ctx.context.baseURL` resolves to, i.e. the public origin plus its
 *   `basePath` (".../auth"). NOT the bare origin: the auth service's own
 *   token endpoint lives at that effective base, and if this is passed the
 *   origin instead, `validAudiences` silently omits it. See auth.js, which
 *   derives this from the same `AUTH_BASE_PATH` its `basePath` option uses.
 * @param {string} publicOrigin The bare public origin, no path -- used only
 *   to build the MCP resource URI.
 */
export function oauthOptions({ baseURL, publicOrigin }) {
  return {
    // Real paths, not hash routes: Better Auth appends query parameters to
    // these, and anything after a `#` lands in the fragment rather than in
    // location.search. FastAPI serves the SPA shell at both.
    loginPage: "/sign-in",
    consentPage: "/consent",

    scopes: [...SCOPES, "offline_access"],

    // Load-bearing. This defaults to [baseURL], which is `.../auth` -- while
    // every MCP client sends resource=`.../mcp`. Left at the default, Better
    // Auth throws invalid_request and EVERY connection attempt fails at the
    // token endpoint, with an error that names neither this option nor the fix.
    validAudiences: [baseURL, MCP_RESOURCE(publicOrigin)],

    // Explicit, because the plugin's own default is
    // ["authorization_code", "client_credentials", "refresh_token"] -- and an
    // object spread means a key this file does not set falls through to that
    // default rather than being absent. It is enforced server-wide at the
    // token endpoint regardless of what any individual registered client
    // asks for, so leaving this unset would let client_credentials through.
    //
    // client_credentials is excluded on purpose: it mints a token with no
    // `sub`, and every persona query in this system keys off a user id --
    // there is nothing to scope a subject-less token to.
    grantTypes: ["authorization_code", "refresh_token"],

    // Claude and ChatGPT have no pre-issued client_id for this server; they
    // register at connect time. The MCP specification now marks dynamic
    // registration deprecated in favour of Client ID Metadata Documents, which
    // Better Auth does not yet support -- so this is a compatibility bridge,
    // not the destination. Registering grants nothing on its own: a real,
    // invited human still has to sign in and consent.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,

    // Short, so that revoking a connection bites in minutes rather than hours.
    // The refresh token dies immediately on revoke; this bounds how long the
    // access token already in flight outlives it.
    accessTokenExpiresIn: "10m",
    refreshTokenExpiresIn: "30d",

    rateLimit: {
      register: { window: 60, max: 5 },
      token: { window: 60, max: 20 },
      authorize: { window: 60, max: 30 },
    },
  };
}

export function oauthPlugin({ baseURL, publicOrigin }) {
  return oauthProvider(oauthOptions({ baseURL, publicOrigin }));
}

/**
 * End one user's connection to one client: refresh tokens first, consent last.
 *
 * The plugin's own `/oauth2/delete-consent` removes the consent row and nothing
 * else, and its `refresh_token` grant never reads that row -- it validates
 * `oauthRefreshToken` alone (verified in the shipped source: the grant checks
 * the row's `clientId`, `expiresAt` and `revoked`, and no query touches
 * `oauthConsent`). A connection revoked through the consent row therefore keeps
 * minting access tokens for the refresh token's full 30 days, which is the
 * opposite of what the button says.
 *
 * `/oauth2/revoke` is not the answer either. RFC 7009 revocation is a CLIENT
 * operation: the endpoint requires the token itself plus that client's
 * credentials, and validates them before doing anything. A person in their own
 * account settings has neither -- they are revoking someone else's token, which
 * is exactly the case RFC 7009 does not cover. Hence this.
 *
 * `revoked` is set rather than the row deleted, because that is the column the
 * grant checks -- and a revoked row also makes the plugin invalidate the whole
 * refresh family if the old token is ever replayed, which a deleted row would
 * not.
 *
 * One transaction: a half-done revoke that dropped the consent row but left the
 * tokens alive would hide a live connection from the very screen meant to end
 * it.
 *
 * @returns the clientId and what was killed, or null if no such consent belongs
 *   to this user. The caller distinguishes "not yours" from "done".
 */
export async function revokeConnection(pool, { consentId, userId }) {
  const client = await pool.connect();
  try {
    await client.query("begin");

    // userId is in the WHERE clause, not checked afterwards: one query that
    // cannot match another person's consent is safer than two that could drift.
    const { rows } = await client.query(
      `select "clientId" from better_auth."oauthConsent"
        where "id" = $1 and "userId" = $2`,
      [consentId, userId],
    );
    if (rows.length === 0) {
      await client.query("rollback");
      return null;
    }
    const clientId = rows[0].clientId;

    const refresh = await client.query(
      `update better_auth."oauthRefreshToken"
          set "revoked" = now()
        where "clientId" = $1 and "userId" = $2 and "revoked" is null`,
      [clientId, userId],
    );

    // Opaque access tokens are stored and so can be destroyed outright. JWT
    // access tokens are not stored at all and cannot be -- which is why the UI
    // says a request already in flight can survive up to ten minutes.
    const access = await client.query(
      `delete from better_auth."oauthAccessToken"
        where "clientId" = $1 and "userId" = $2`,
      [clientId, userId],
    );

    await client.query(`delete from better_auth."oauthConsent" where "id" = $1`, [
      consentId,
    ]);

    await client.query("commit");
    return {
      clientId,
      refreshTokensRevoked: refresh.rowCount,
      accessTokensDeleted: access.rowCount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
