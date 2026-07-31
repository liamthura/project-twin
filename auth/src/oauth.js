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
 * The canonical form of a resource URI, per RFC 8707 and RFC 9728.
 *
 * The trailing slash is stripped deliberately: the MCP specification says
 * implementations SHOULD use the form without one, and an audience is compared
 * by exact string, so `https://host/mcp/` and `https://host/mcp` are two
 * different resources to every client that follows the rule. This runs over
 * whatever the operator typed, which is where that mistake actually gets made.
 */
export const canonicalResource = (value) => (value || "").trim().replace(/\/+$/, "");

/**
 * The MCP endpoint this instance serves, or "" if it serves none.
 *
 * The SAME variable the API container reads, with the same meaning and the
 * same expected value (`https://your-instance/mcp`) -- an audience is an exact
 * string match across the two services, so two names for it would be two
 * chances to disagree.
 *
 * Empty is what gates the whole OAuth surface off. An authorization server is
 * not something an instance should acquire by upgrading: unset, this container
 * would otherwise expose `/auth/oauth2/register`, which anonymous callers may
 * post to, on every deployment whose operator never opted in.
 */
export function mcpResource(env = process.env) {
  return canonicalResource(env.AUTH_MCP_RESOURCE);
}

/**
 * The plugin's options, exported separately so they can be asserted on.
 *
 * @param {string} baseURL Better Auth's own EFFECTIVE base -- what
 *   `ctx.context.baseURL` resolves to, i.e. the public origin plus its
 *   `basePath` (".../auth"). NOT the bare origin: the auth service's own
 *   token endpoint lives at that effective base, and if this is passed the
 *   origin instead, `validAudiences` silently omits it. See auth.js, which
 *   derives this from the same `AUTH_BASE_PATH` its `basePath` option uses.
 * @param {string} mcpResource The canonical MCP resource URI, from
 *   AUTH_MCP_RESOURCE. Never derived from the origin here: the API container
 *   checks an access token's `aud` against its own copy of this value by exact
 *   string, and two independent derivations are two things to drift.
 */
export function oauthOptions({ baseURL, mcpResource }) {
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
    validAudiences: [baseURL, mcpResource],

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
    // SECONDS, as numbers. Not a time-span string: the plugin adds these
    // straight onto a unix timestamp (`iat + opts.accessTokenExpiresIn`), so
    // "10m" makes that a string concatenation, the resulting Date is Invalid,
    // and Postgres rejects the insert with
    //   invalid input syntax for type timestamp with time zone:
    //   "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"
    // -- which reaches the user as a 500 on Allow, naming nothing that helps.
    // The plugin's own defaults are numbers (3600, 2592000); this pins that.
    accessTokenExpiresIn: 10 * 60,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,

    rateLimit: {
      register: { window: 60, max: 5 },
      token: { window: 60, max: 20 },
      authorize: { window: 60, max: 30 },
    },
  };
}

export function oauthPlugin({ baseURL, mcpResource }) {
  return oauthProvider(oauthOptions({ baseURL, mcpResource }));
}

/** The scope that decides whether a grant may hold a refresh token. */
export const REFRESH_SCOPE = "offline_access";

/**
 * The scope string a registration should be stored with, or undefined to leave
 * it alone.
 *
 * An empty request is left alone deliberately: the plugin already defaults a
 * scope-less registration to the full `scopes` option, which contains
 * offline_access, so there is nothing to correct.
 */
export function registrationScopes(scope) {
  const requested = (scope || "").split(" ").filter(Boolean);
  if (!requested.length) return undefined;
  if (requested.includes(REFRESH_SCOPE)) return undefined;
  return [...requested, REFRESH_SCOPE].join(" ");
}

/**
 * Make a dynamically registered client capable of holding a refresh token.
 *
 * Two decisions collide here, each correct on its own. Our protected-resource
 * metadata omits offline_access, because the MCP specification says a resource
 * server SHOULD NOT advertise it -- refresh tokens are the client's concern,
 * not the resource's. And `/oauth2/authorize` validates a request against the
 * REGISTERED client's scopes rather than the server's:
 *
 *     const validScopes = new Set(client.scopes ?? opts.scopes);
 *
 * A client that registers using the scope list it read from our resource
 * metadata is therefore stored without offline_access -- and then fails with
 * `invalid_scope` the moment it asks for the refresh token it is entitled to.
 * Observed against Claude Code on the first real connection; the metadata is
 * right, the plugin is right, and the client is right.
 *
 * Adding it at registration keeps the metadata spec-compliant and fixes the
 * thing that is actually broken: a client that could never refresh. It grants
 * nothing on its own -- the consent screen still decides what is handed over,
 * and offline_access only ever means "may hold a refresh token", never "may
 * read or write a persona".
 */
export function oauthRegistrationScopePlugin(createAuthMiddleware) {
  return {
    id: "mygist-oauth-registration-scope",

    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/oauth2/register",
          handler: createAuthMiddleware(async (ctx) => {
            const scope = registrationScopes(ctx.body?.scope);
            if (!scope) return;
            return { context: { body: { ...ctx.body, scope } } };
          }),
        },
      ],
    },
  };
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
