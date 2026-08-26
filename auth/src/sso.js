/**
 * MyGist as an OAuth CLIENT of an OIDC provider.
 *
 * The mirror image of oauth.js, which makes MyGist an authorization SERVER for
 * MCP clients. Both are true at once and neither is duplication: MyGist owns
 * the scopes and consent for persona access -- Authentik has no business
 * knowing what `persona:write` means -- while Authentik owns who the person is.
 *
 * Everything here is gated on AUTH_OIDC_DISCOVERY_URL, the same fail-closed
 * rule AUTH_MCP_RESOURCE follows in oauth.js. A self-hosted instance that never
 * asked for federated sign-in does not acquire one by upgrading.
 *
 * NO ENDPOINTS OF ITS OWN, and none from genericOAuth either. That changed in
 * 1.7: the plugin now injects a provider into `context.socialProviders` and the
 * flow rides the CORE routes -- /sign-in/social, /callback/:id, /link-social.
 * The redirect URI Authentik must be given is therefore
 * `<origin>/auth/callback/authentik`, with no `oauth2` segment in it.
 */
import { APIError, createAuthEndpoint } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwtVerify } from "jose";

/** Matches the Application slug on Authentik, and the `providerId` stored on
 *  every federated account row. Changing it re-keys every linked account. */
export const PROVIDER_ID = "authentik";

const required = (env, name) => {
  const value = (env[name] || "").trim();
  if (!value) {
    // Same rule as auth.js: fail at boot rather than at first sign-in. A
    // half-configured provider shows the button and fails inside a browser
    // redirect, which is the least reachable place to put a reason.
    throw new Error(`${name} is required when AUTH_OIDC_DISCOVERY_URL is set`);
  }
  return value;
};

/** The gate. Empty string when SSO is not configured. */
export function ssoDiscoveryUrl(env = process.env) {
  return (env.AUTH_OIDC_DISCOVERY_URL || "").trim();
}

/**
 * The handle, at creation only.
 *
 * OIDC's one stable identifier is `sub`; `preferred_username` is a mutable
 * attribute. Tracking it would drift public.users away from the IdP on any
 * rename -- silently, since nothing would error. `overrideUserInfo` is left at
 * its default `false` for exactly that reason.
 *
 * Pure, and it has to be: this runs on EVERY callback, before link-or-create is
 * decided, not only when an account is made.
 */
export function mapProfileToUser(profile) {
  const handle = profile?.preferred_username;
  return { username: typeof handle === "string" ? handle : undefined };
}

/**
 * The username the provisioning hook writes into public.users.
 *
 * Replaces `user.username ?? user.name`. That fallback's real behaviour was to
 * write a DISPLAY name -- "Khant Thura", space and all -- into a column the
 * legacy /api/auth/login treats as a credential. There is no correct value to
 * invent here, so there is no fallback.
 *
 * The unique constraint on public.users.username is the collision handling, and
 * deliberately so. Resolving a clash to `liam-2` would hand someone a second,
 * empty account with no persona data, which reads as "my data is gone". Failing
 * is correct; the fix is to link, never to rename.
 */
export function usernameFor(user) {
  const username = typeof user?.username === "string" ? user.username.trim() : "";
  if (!username) {
    // Every user create comes through here, not only federated ones: Better
    // Auth treats `username` as optional on /sign-up/email, so a scripted
    // sign-up that omits it lands here too. The message has to make sense to
    // whoever hit it, which on most instances is someone with no provider at
    // all -- so it names the field first and the provider's mapping only as
    // the case where that field goes missing on its own.
    throw new Error(
      "Cannot create an account with no username. A sign-up must supply " +
        "`username`; a federated sign-in takes it from `preferred_username`, " +
        "so if this was an SSO sign-in, check the provider's scope mappings " +
        "include `profile`.",
    );
  }
  return username;
}

/** The GenericOAuthConfig, separated from the plugin so it can be asserted
 *  without a network: genericOAuth's own init fetches the discovery document. */
export function ssoConfig(env = process.env) {
  return {
    providerId: PROVIDER_ID,

    // One variable for the whole document rather than an issuer we concatenate
    // onto: no trailing-slash bug, nothing to get wrong.
    discoveryUrl: ssoDiscoveryUrl(env),

    clientId: required(env, "AUTH_OIDC_CLIENT_ID"),
    clientSecret: required(env, "AUTH_OIDC_CLIENT_SECRET"),

    // `email` is not optional: Better Auth hard-errors with `email_is_missing`
    // if the callback returns no address.
    scopes: ["openid", "profile", "email"],

    // Both are 1.7 defaults; stated anyway because they are decisions rather
    // than accidents, and a default that changes should break a test here
    // rather than a sign-in in production.
    pkce: true,

    // Refuses to register the provider at all unless discovery yields an issuer
    // AND a jwks_uri. Without it, an incomplete discovery document silently
    // downgrades to unverified token decoding.
    requireIdTokenVerification: true,

    // Signing out of MyGist does not sign you out of Authentik. Global sign-out
    // is a separate, deliberate feature if closing one app should ever close
    // all of them.
    disableProviderLogout: true,

    mapProfileToUser,
  };
}

/** The plugin list -- empty, and therefore inert, when the gate is closed. */
export function ssoPlugins(env = process.env) {
  if (!ssoDiscoveryUrl(env)) return [];
  return [
    genericOAuth({ config: [ssoConfig(env)] }),
    backchannelLogoutPlugin(),
  ];
}

// ---------------------------------------------------------------------------
// Back-channel logout
// ---------------------------------------------------------------------------

/** OIDC Back-Channel Logout 1.0, section 2.4. */
export const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * The configured provider, from Better Auth's own context.
 *
 * Mirrors `getAwaitableValue` in context/helpers.mjs: entries may be plain
 * objects or thunks. Read rather than rebuilt so the receiver cannot drift from
 * the sign-in path -- the issuer, audience, algorithms and JWKS below are the
 * exact ones genericOAuth discovered at boot.
 */
async function findProvider(context, id) {
  for (const entry of context?.socialProviders ?? []) {
    const provider = typeof entry === "function" ? await entry() : entry;
    if (provider?.id === id) return provider;
  }
  return null;
}

/**
 * Verify a logout token and return its claims.
 *
 * Throws on anything short of a fully valid token. Signature, issuer, audience
 * and expiry are `jose`'s job; the three checks after it are the ones that
 * separate a logout token from an ID token, and skipping them turns an
 * id_token captured from an ordinary sign-in into a remote sign-out button.
 *
 * `algorithms` below is defence in depth, not the load-bearing check: jose's
 * JWKS resolver already refuses `none` and any HMAC algorithm before it will
 * even resolve a key. What IS load-bearing is `issuer` and `audience` being
 * non-undefined -- jose skips those checks entirely when an option is
 * `undefined`, and they are guaranteed non-undefined today only because
 * `idToken` is built as one unit by genericOAuth from a single discovery
 * document. If that ever stops being true, this endpoint's entire security
 * rests on whatever replaces it still being true.
 */
export async function verifyLogoutToken(provider, token) {
  const idToken = provider?.idToken;
  if (!idToken) {
    throw new Error(
      "The SSO provider has no verified ID-token configuration, so a logout " +
        "token cannot be checked. This should be unreachable: " +
        "requireIdTokenVerification refuses to register the provider without one.",
    );
  }

  const { payload } = await jwtVerify(token, idToken.jwks, {
    issuer: idToken.issuer,
    audience: idToken.audience,
    algorithms: idToken.algorithms,

    // jose treats `exp` as optional (jwt_claims_set.js checks it only `if
    // (exp !== undefined)`), and OIDC Back-Channel Logout 1.0 section 2.4
    // does not require a logout token to carry one -- only `iat` and `jti`
    // are REQUIRED. Without maxTokenAge, a logout token that omits exp would
    // verify forever, and with no jti replay cache that would make a
    // captured token an unlimited, repeatable "end this user's sessions"
    // button. maxTokenAge is what actually bounds the token's life here; that
    // bound is what makes deliberately not keeping a jti cache defensible
    // rather than negligent.
    //
    // maxTokenAge bounds STALENESS only, on one side. clockTolerance is what
    // absorbs skew between two independently-clocked hosts on the other:
    // jose's iat check has no default tolerance (clockTolerance defaults to
    // 0), so without this, Authentik's clock running even a second or two
    // ahead of ours puts iat in the future and rejects EVERY logout token
    // with "it should be in the past" -- a regression that would present as
    // back-channel logout silently never working, blaming the token rather
    // than the clocks.
    maxTokenAge: "5 minutes",
    clockTolerance: "30 seconds",
    requiredClaims: ["iat", "jti"],
  });

  if (!payload.events || typeof payload.events !== "object") {
    throw new Error("logout token has no events claim");
  }
  if (!(LOGOUT_EVENT in payload.events)) {
    throw new Error("logout token does not carry the back-channel logout event");
  }
  // Section 2.4 again: a nonce is what makes a token an ID token. Its presence
  // means this is a replayed id_token, not a logout notification.
  if ("nonce" in payload) {
    throw new Error("logout token must not carry a nonce");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("logout token has no sub, so it names nobody to sign out");
  }

  return payload;
}

/**
 * The receiver Authentik posts to when a session ends there.
 *
 * Unauthenticated by necessity -- the caller is Authentik, not a browser with a
 * cookie -- so the token IS the authentication, and nothing in it is trusted
 * until verifyLogoutToken returns.
 *
 * Revokes BROWSER SESSIONS ONLY. Opaque API tokens and MCP connections are left
 * alone on purpose: Authentik sends this on an ordinary session end, and
 * killing long-lived credentials that sit in config files on other machines
 * would break every MCP client with no way to tell them why. An account-disable
 * path that also revokes tokens is a separate mechanism, if it is ever wanted.
 *
 * Configure the URL on the Authentik provider as:
 *     <your public origin>/auth/backchannel-logout
 */
export function backchannelLogoutPlugin() {
  return {
    id: "mygist-sso-logout",

    endpoints: {
      backchannelLogout: createAuthEndpoint(
        "/backchannel-logout",
        {
          method: "POST",
          // Better Auth's router defaults EVERY endpoint to
          // application/json only (api/index.mjs's `allowedMediaTypes`),
          // and OIDC Back-Channel Logout 1.0 section 2.5 makes
          // application/x-www-form-urlencoded the only thing a provider
          // will ever send -- Authentik has no other mode. Without this
          // override, better-call's body parser (utils.mjs) rejects every
          // real logout call with 415 before the handler below runs at
          // all, so the receiver silently never works: Authentik gets an
          // error status back and there is no user watching to notice.
          // json is accepted alongside it only because the OAuth provider
          // plugin's own callback route does the same (callback.mjs,
          // sign-in.mjs) and verification below is identical either way.
          metadata: {
            allowedMediaTypes: ["application/x-www-form-urlencoded", "application/json"],
          },
        },
        async (ctx) => {
          // Authentik posts application/x-www-form-urlencoded. better-call's
          // body parser (utils.mjs) turns that into ctx.body -- but only
          // once the metadata override above has let the request past the
          // router's media-type gate; without it, the request never reaches
          // this parser, let alone this line.
          const token = ctx.body?.logout_token;
          if (!token) {
            throw new APIError("BAD_REQUEST", { message: "logout_token is required" });
          }

          const provider = await findProvider(ctx.context, PROVIDER_ID);
          if (!provider) {
            throw new APIError("NOT_FOUND", { message: "No SSO provider configured." });
          }

          let claims;
          try {
            claims = await verifyLogoutToken(provider, token);
          } catch (error) {
            // Logged, because a provider misconfiguration is silent otherwise:
            // Authentik retries, gets 400, and neither side says why.
            ctx.context.logger.warn(
              `[sso] rejected a back-channel logout token: ${error?.message ?? error}`,
            );
            throw new APIError("BAD_REQUEST", { message: "Invalid logout token." });
          }

          // `iss` IS the stored account issuer: genericOAuth namespaces a
          // federated account by the DISCOVERED issuer (index.mjs:143), and
          // OIDC requires a logout token's iss to be that same value.
          const owner = await ctx.context.internalAdapter.findAccountOwnerByKey({
            issuer: claims.iss,
            accountId: claims.sub,
          });

          // 200 for an unknown subject, deliberately: OIDC Back-Channel
          // Logout 1.0 section 2.8 mandates it, and there is nothing the
          // caller could do with a different answer either way.
          if (owner?.kind === "owned") {
            await ctx.context.internalAdapter.deleteUserSessions(owner.user.id);
          }

          // Section 2.8: 200, an empty JSON body, and no caching.
          ctx.setHeader("Cache-Control", "no-store");
          return ctx.json({});
        },
      ),
    },
  };
}
