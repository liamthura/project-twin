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
 * Took Better Auth's effective base URL as a second argument until 1.7. That
 * existed solely to put the auth service's own base into `validAudiences`,
 * which 1.7 removed; nothing else here ever read it, and Better Auth computes
 * its own base for itself. Gone rather than kept unused, because an argument a
 * caller has to derive correctly and nothing consumes is a trap.
 *
 * @param {string} mcpResource The canonical MCP resource URI, from
 *   AUTH_MCP_RESOURCE. Never derived from the origin here: the API container
 *   checks an access token's `aud` against its own copy of this value by exact
 *   string, and two independent derivations are two things to drift.
 */
export function oauthOptions({ mcpResource }) {
  return {
    // Real paths, not hash routes: Better Auth appends query parameters to
    // these, and anything after a `#` lands in the fragment rather than in
    // location.search. FastAPI serves the SPA shell at both.
    loginPage: "/sign-in",
    consentPage: "/consent",

    // Also, since 1.7, what EVERY dynamically registered client is stored
    // with, whatever scope it asked for -- the plugin overwrites a dynamic
    // registration's scope with this list rather than honouring the request.
    //
    // That fixed a bug this file used to carry a hook for. Our protected-
    // resource metadata omits offline_access, because the MCP specification
    // says a resource server SHOULD NOT advertise it; a client registering with
    // the list it read there was stored without it on 1.6, and
    // /oauth2/authorize validates against the REGISTERED client's scopes -- so
    // asking for the refresh token it was entitled to came back
    // `invalid_scope`. Found by Claude Code on the first real connection, and
    // fixed here by adding offline_access at registration. 1.7 makes that hook
    // do nothing, so it is gone; the test that watches the outcome it protected
    // -- "a client registered from our resource metadata can still refresh" --
    // stays, and is now the only thing holding the property.
    //
    // The ceiling this raises for a narrow client is not a grant: what a client
    // actually receives is the scope on its authorize request, and the consent
    // screen offers exactly that and nothing wider (see Consent.jsx).
    scopes: [...SCOPES, "offline_access"],

    // Load-bearing, and the successor to 1.6's `validAudiences`, which 1.7
    // removed entirely. A resource is now a persisted `oauthResource` row
    // rather than a string in a list: the plugin seeds one per entry here on
    // first use, and an authorize request naming a resource with no row is
    // refused with
    //
    //     invalid_target: requested resource ... is not configured
    //
    // -- which lands in the browser as a failed callback, not as a startup
    // error, so an instance that forgot this looks fine until someone connects.
    //
    // One entry, where `validAudiences` needed two. 1.6 defaulted that option
    // to the auth service's own base and every MCP client sends
    // resource=`.../mcp`, so that base had to be re-listed alongside it. 1.7
    // has no implicit default to preserve, and the auth base is not a protected
    // resource this server issues tokens for -- listing it would seed a row and
    // let a client ask for a token audienced at the authorization server
    // itself.
    resources: [mcpResource],

    // Off, which is 1.6's behaviour: a client may ask for any enabled
    // resource. 1.7 defaults it ON, and then refuses an authorize request from
    // a client with no `oauthClientResource` row --
    //
    //     invalid_target: client ... is not linked to resource(s) .../mcp
    //
    // Two reasons it stays off. Every client registered before this upgrade has
    // no link row and never could have, so leaving the default on would break
    // every connection that already exists, at the first authorize after
    // deploying, with nothing an operator could do but tell people to
    // reconnect. And there is exactly ONE resource here: a table saying which
    // clients may reach which resource has nothing to say while the answer is
    // always the same one.
    //
    // Turn it on if a second resource is ever added -- but backfill
    // `oauthClientResource` for the existing clients in the same migration,
    // because that is the step this note exists to remember.
    enforcePerClientResources: false,

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

export function oauthPlugin({ mcpResource }) {
  return oauthProvider(oauthOptions({ mcpResource }));
}

/**
 * The three hosts Better Auth 1.7 accepts an `http` redirect URI on, spelled
 * exactly as RFC 8252 section 7.3 spells them.
 */
// `[::1]` keeps its brackets: that is what URL.hostname returns for an IPv6
// literal, and what Better Auth's own check compares against.
const NATIVE_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `"native"` if this registration is a native app that did not say so, else
 * undefined to leave it alone.
 *
 * Better Auth 1.7 began validating redirect URIs against the client's
 * `application_type`, and RFC 7591 says an omitted one means `"web"`. A web
 * client may not redirect to loopback at all -- so a client that omits the
 * field and asks for `http://127.0.0.1:9876/callback`, which is every MCP
 * client we have, is now refused at registration with
 *
 *     web clients require https redirect URIs on non-loopback hosts
 *
 * That URI was accepted on 1.6, is documented as accepted in
 * run/troubleshooting, and is what RFC 8252 tells a native app to use. The
 * client is not wrong; it just never filled in a field it had no reason to.
 *
 * Deciding it from the redirect URIs is the same inference the standard makes:
 * an app whose callback is an http loopback address IS a native app. This
 * never widens what the server accepts -- Better Auth validates afterwards
 * either way, and the worst a wrong guess here can do is leave a refusal that
 * would have happened anyway. Compare `_is_loopback_host` in
 * backend/auth_proxy.py, which restates the same rule under the same rule of
 * never deciding anything.
 */
export function registrationApplicationType(body) {
  if (body?.application_type !== undefined) return undefined;
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return undefined;

  // EVERY URI, not some: a client mixing a loopback callback with an https one
  // is a web client that also listens locally, and calling it native would
  // refuse the https URI it actually uses.
  const allLoopback = uris.every((uri) => {
    let url;
    try {
      url = new URL(uri);
    } catch {
      return false;
    }
    return url.protocol === "http:" && NATIVE_HTTP_HOSTS.has(url.hostname);
  });
  return allLoopback ? "native" : undefined;
}

/**
 * Let a native app register the loopback callback it is entitled to.
 *
 * See registrationApplicationType. Sits in front of `/oauth2/register` rather
 * than in the plugin options because there is no option: the `"web"` default
 * is a literal in the plugin's own register path, not a setting.
 */
export function oauthRegistrationNativePlugin(createAuthMiddleware) {
  return {
    id: "mygist-oauth-registration-native",

    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/oauth2/register",
          handler: createAuthMiddleware(async (ctx) => {
            const applicationType = registrationApplicationType(ctx.body);
            if (!applicationType) return;
            return { context: { body: { ...ctx.body, application_type: applicationType } } };
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
