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
import { genericOAuth } from "better-auth/plugins/generic-oauth";

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
    throw new Error(
      "Cannot provision an account with no username. An SSO sign-in must " +
        "supply preferred_username -- check the Authentik provider's scope " +
        "mappings include `profile`.",
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
  return [genericOAuth({ config: [ssoConfig(env)] })];
}
