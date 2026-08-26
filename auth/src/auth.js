/**
 * Better Auth configuration for MyGist.
 *
 * This service owns HUMAN sign-in only. Machine clients -- MCP over `/mcp`,
 * scripts over `/api` -- authenticate against the Python API with the opaque
 * bearer tokens in the `tokens` table, and never touch this service. That split
 * is deliberate: those tokens live in config files on other people's machines,
 * and a credential you cannot reach is a credential you cannot migrate.
 *
 * Plain ESM JavaScript rather than TypeScript on purpose. This file is
 * configuration, not application code -- roughly sixty meaningful lines -- and
 * a build step would add a compile stage to the image, a tsconfig and a watch
 * pipeline to maintain, for no type surface worth checking. The types still
 * apply in an editor via JSDoc.
 */
import { randomUUID } from "node:crypto";

import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { username } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

import { AUTH_BASE_PATH } from "./base-path.js";
import { poolConfig } from "./db-config.js";
import { createMailer } from "./email.js";
import * as invite from "./invite.js";
import {
  mcpResource,
  oauthPlugin,
  oauthRegistrationNativePlugin,
  revokeConnection,
} from "./oauth.js";
import { PROVIDER_ID, ssoPlugins, usernameFor } from "./sso.js";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    // Fail at boot rather than at first sign-in. The same reasoning as the
    // section pack loader: an auth service that starts misconfigured and fails
    // later reports the problem far from its cause.
    throw new Error(`${name} is required`);
  }
  return value;
};

// The PUBLIC origin. Set explicitly so Better Auth never infers its own URLs
// from forwarded headers -- FastAPI proxies /auth/* to this service, and an
// inferred base would produce internal addresses in redirects and cookies.
const baseURL = required("BETTER_AUTH_URL");

// Logs instead of sending when no provider is configured, so reset and
// verification can be walked end to end before Resend exists.
const mailer = createMailer();

// The MCP endpoint this instance serves, and the switch for the whole OAuth
// surface below. Same variable, same value as the API container's
// AUTH_MCP_RESOURCE -- see oauth.js.
const MCP_RESOURCE = mcpResource();

// One pool, shared by Better Auth and the provisioning hook below. search_path
// pins Better Auth's own queries to its schema; the hook reaches into `public`
// by qualifying the table explicitly, which works regardless of search_path.
//
// poolConfig translates libpq's sslmode into what node-postgres actually needs
// -- and removes sslmode from the string, because leaving it in lets
// ConnectionParameters overwrite the translation with its own. See db-config.js;
// the reasoning is long enough to be worth reading before touching this.
export const pool = new Pool(poolConfig(required("DATABASE_URL")));

/**
 * The invite gate, as a plugin so the check endpoint and the gate itself sit
 * together and read the same module.
 *
 * Both are inert when INVITE_ONLY is off, which is the default and what every
 * self-hosted instance runs. Off, this adds one comparison to a sign-up.
 */
function invitePlugin() {
  return {
    id: "mygist-invite",

    endpoints: {
      // Backs the first screen of sign-up. Says only valid or not: naming
      // WHICH way a code failed tells a guesser which ones are worth pursuing
      // and tells a genuine tester nothing they can act on.
      checkInvite: createAuthEndpoint(
        "/invite/check",
        { method: "POST" },
        async (ctx) => {
          if (!invite.inviteOnly()) return ctx.json({ valid: true });
          const result = await invite.check(pool, ctx.body?.code);
          return ctx.json({ valid: result.ok });
        },
      ),
    },

    hooks: {
      before: [
        {
          matcher: (context) => context.path === "/sign-up/email",
          handler: createAuthMiddleware(async (ctx) => {
            if (!invite.inviteOnly()) return;

            // Read-only. Reserving here would burn a use whenever the sign-up
            // that follows fails -- a duplicate username, most likely -- and
            // telling someone holding a good code that it is spent is a worse
            // failure than admitting one extra on a race.
            const result = await invite.check(pool, ctx.body?.inviteCode);
            if (!result.ok) {
              throw new APIError("BAD_REQUEST", { message: result.reason });
            }
          }),
        },
      ],
    },
  };
}

/**
 * The one thing the OAuth plugin does not offer: a person ending someone
 * else's connection to their own account.
 *
 * The plugin has two revocation paths and neither fits. `/oauth2/delete-consent`
 * deletes the consent row, which the refresh grant never consults, so the
 * connection carries on refreshing for thirty days. `/oauth2/revoke` is RFC 7009
 * and therefore a CLIENT operation -- it wants the token plus that client's
 * credentials, which is precisely what the account holder does not have.
 *
 * Same shape as invitePlugin above, and for the same reason: an endpoint that
 * needs `pool` belongs beside the pool.
 */
function oauthRevokePlugin() {
  return {
    id: "mygist-oauth-revoke",

    endpoints: {
      revokeConnection: createAuthEndpoint(
        "/oauth2/revoke-connection",
        { method: "POST" },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session) throw new APIError("UNAUTHORIZED");

          const id = ctx.body?.id;
          if (!id) {
            throw new APIError("BAD_REQUEST", { message: "id is required" });
          }

          const result = await revokeConnection(pool, {
            consentId: id,
            userId: session.user.id,
          });
          // Null means the consent is not this user's -- or does not exist.
          // Both answer the same way: naming the difference would turn this
          // into an oracle for which consent ids are real.
          if (!result) throw new APIError("NOT_FOUND", { message: "No such connection." });

          return ctx.json({ revoked: true });
        },
      ),
    },
  };
}

export const auth = betterAuth({
  baseURL,

  // Mounted at /auth, matching what FastAPI forwards. The proxy passes the
  // path through unchanged, so both sides must agree on this prefix.
  //
  // Pulled from base-path.js rather than written here as a literal, because
  // the jwt() plugin below pins its issuer and audience to `baseURL` plus this
  // exact path. Better Auth's own effective base (ctx.context.baseURL) is
  // origin + basePath, not the bare origin, and those two derivations have to
  // agree or the API cannot verify both token types with one AUTH_ISSUER --
  // see the jwt() comment for what that failure looked like.
  //
  // The OAuth plugin needed the same value until 1.7, for `validAudiences`.
  // That option no longer exists, oauthOptions no longer takes a base at all,
  // and Better Auth computes its own. See oauth.js.
  basePath: AUTH_BASE_PATH,

  // Minimum 32 characters, per the installation docs. BETTER_AUTH_SECRETS
  // (plural) is also read by Better Auth for rotation without invalidating
  // existing sessions -- worth knowing before the first rotation, not during.
  secret: required("BETTER_AUTH_SECRET"),

  // Same Postgres as the rest of MyGist. One database keeps the auth tables in
  // the same backup, the same migration story and the same failure domain as
  // the persona data they authorise access to.
  //
  // search_path pins every query to the `better_auth` schema. Better Auth's
  // table names are generic -- "user", "session", "account" -- and in `public`
  // they would sit beside MyGist's `users` and `tokens`, where `public.user`
  // next to `public.users` is a trap for whoever reads this database next.
  // The tables themselves are created by Alembic (migration 0003), not by
  // Better Auth's CLI, so that one tool owns the schema.
  database: pool,

  advanced: {
    database: {
      // Better Auth's own id generator emits a random string. MyGist's
      // `public.users.id` is a `uuid` column, referenced by foreign keys from
      // persona_data and persona_search, so a non-UUID id could not be stored
      // there at all -- and the whole identity model rests on the two ids being
      // the same value. Generating UUIDs here is what lets a NEW account keep
      // the one-id-space property that seeding gave the existing ones.
      generateId: () => randomUUID(),
    },
  },

  account: {
    accountLinking: {
      // Explicit only. Better Auth's sign-in path looks an existing user up by
      // email and would link the account to it, refusing today only because
      // Authentik reports `email_verified: false` and MyGist's seeded accounts
      // are unverified. Both are contingent; auto-linking on an email a
      // provider cannot truthfully assert is a known takeover class, so the
      // decision is configured rather than inferred from a default.
      //
      // This is the option that still forbids adoption-by-email on sign-in.
      // oauth2/link-account.mjs:83 refuses as soon as this is true, as one
      // disjunct of an OR that no other setting below can satisfy away.
      disableImplicitLinking: true,

      // The two below apply ONLY to the explicit link callback -- the path
      // /link-social starts and api/routes/callback.mjs:150 finishes. Nothing
      // on the sign-in path reads either: `allowDifferentEmails` is read at
      // exactly two places, callback.mjs:175 and account.mjs:213, and both are
      // explicit-link guards.

      // Required, not optional, and the whole migration depends on it.
      // callback.mjs:175 compares the provider's address against the address
      // on the signed-in account. Seeding gave every account that predates SSO
      // a `<username>@mygist.invalid` placeholder, which can never equal a real
      // address, so without this the callback returns EMAIL_DOES_NOT_MATCH for
      // every existing account and there is no way to link at all.
      allowDifferentEmails: true,

      // callback.mjs:171 also refuses an untrusted provider whenever the
      // provider does not assert `email_verified`, which Authentik does not by
      // default. Trusting our own configured provider clears that; it cannot
      // reopen implicit linking, because disableImplicitLinking above rejects
      // first regardless of whether the provider is trusted.
      trustedProviders: [PROVIDER_ID],
    },
  },

  user: {
    changeEmail: {
      // "Add an email" IS a change-email for every existing account: seeding
      // gave them <username>@mygist.invalid, so there is always an address
      // there and never a real one.
      enabled: true,

      // Load-bearing. Better Auth's default is to confirm a change by mailing
      // the CURRENT address first -- which for a placeholder means sending to
      // an .invalid domain that RFC 2606 guarantees can never resolve. Every
      // existing account would be unable to add an email at all, and the
      // failure would look like a mail problem rather than a design one.
      //
      // A placeholder is unverified by construction, so this permits exactly
      // the case that must work and nothing else: a real, verified address
      // still cannot be changed without confirming from the old one.
      updateEmailWithoutVerification: true,

      // The other branch: someone who has already verified an address and now
      // wants a different one. Approval goes to the address we know reaches
      // them, so losing an inbox does not mean losing the account.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await mailer.send({
          to: user.email,
          subject: "Approve your MyGist email change",
          text:
            `Someone asked to change this MyGist account's email to ` +
            `${newEmail}. Approve it here:\n\n${url}\n\n` +
            `If that was not you, ignore this email — the address stays as ` +
            `it is and nothing changes.`,
        });
      },
    },
  },

  databaseHooks: {
    user: {
      create: {
        // A Better Auth account is only half an account: the persona tables key
        // off `public.users`, and `db.resolve_user_by_id` deliberately refuses
        // to create a missing row, so that drift between the two stores stays
        // visible rather than being silently papered over. That strictness is
        // only safe if registration provisions both sides, which is this hook.
        //
        // Runs inside the sign-up flow, so a failure here fails the
        // registration rather than leaving an account that can authenticate but
        // owns nothing.
        after: async (user, ctx) => {
          await pool.query(
            `insert into public.users (id, username, created_at)
             values ($1, $2, now())
             on conflict (id) do nothing`,
            // No fallback to user.name. See usernameFor in sso.js: the old
            // fallback wrote a display name into a column the legacy
            // /api/auth/login treats as a credential.
            [user.id, usernameFor(user)],
          );

          // Redeemed here, not in the gate, so that only an account which
          // actually exists costs a use. Runs after the insert above because
          // it writes users.invited_with, which needs the row to be there.
          if (invite.inviteOnly()) {
            await invite.redeem(pool, ctx?.body?.inviteCode, user.id);
          }
        },
      },
    },
  },

  // The public origin, plus anything BETTER_AUTH_TRUSTED_ORIGINS adds.
  //
  // In development the browser is on the Vite dev server (a different port
  // from BETTER_AUTH_URL), so its Origin header is not the base URL. Measured
  // on 1.6.23, sign-in does not currently reject an untrusted origin -- but
  // that is a property of today's version rather than a promise, and OAuth
  // callbacks will care. Making it configurable costs nothing and means a dev
  // server on any port needs no code edit.
  trustedOrigins: [
    baseURL,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],

  emailVerification: {
    // Verification is what turns a placeholder into a usable address. Until it
    // completes, the account still has <username>@mygist.invalid and cannot be
    // recovered.
    sendVerificationEmail: async ({ user, url }) => {
      await mailer.send({
        to: user.email,
        subject: "Confirm your MyGist email",
        text:
          `Confirm this address so you can reset your MyGist password if you ` +
          `ever lose it.\n\n${url}\n\n` +
          `If you did not add this address to a MyGist account, ignore this ` +
          `email — nothing changes until the link is opened.`,
      });
    },
  },

  emailAndPassword: {
    enabled: true,

    // A reset is what someone does when they think the password is no longer
    // only theirs. Leaving old sessions alive through it would answer that
    // worry with "not really".
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, url }) => {
      await mailer.send({
        to: user.email,
        subject: "Reset your MyGist password",
        text:
          `Open this link to choose a new password:\n\n${url}\n\n` +
          `The link expires shortly, and can be used once.\n\n` +
          `If you did not ask for this, ignore it — your current password ` +
          `still works and nothing has changed.`,
      });
    },

    // The whole migration rests on this. Better Auth hashes with scrypt by
    // default; MyGist's existing passwords are bcrypt, written by
    // `db.hash_password`. Supplying both halves lets every existing account
    // sign in with its existing password, unchanged and unaware.
    //
    // `hash` uses cost 12 to match the Python side's bcrypt.gensalt() default,
    // so a password set here and one set there are indistinguishable.
    password: {
      hash: async (password) => bcrypt.hash(password, 12),
      verify: async ({ hash, password }) => bcrypt.compare(password, hash),
    },
  },

  plugins: [
    // Existing accounts have a username and no email, so username sign-in is
    // not a convenience here -- it is the only identifier they currently have.
    // Email is added later, alongside verification and reset.
    //
    // The validator is widened on purpose. The plugin defaults to
    // /^[a-zA-Z0-9_.]+$/, which rejects hyphens -- and MyGist's own
    // registration only ever trimmed whitespace, so accounts like
    // "localdev-smoke" already exist and would be locked out permanently by
    // the default. The rule here mirrors what MyGist actually enforces today,
    // because the premise of this migration is that no existing account has to
    // change anything.
    //
    // Tightening this for NEW registrations is a reasonable thing to want, but
    // it means migrating the usernames that already exist, and that is a
    // separate decision rather than something to smuggle in here.
    username({
      minUsernameLength: 1,
      maxUsernameLength: 255,
      usernameValidator: async (value) => value.trim().length > 0,
    }),

    // Issues the short-lived JWT the SPA presents to FastAPI, and exposes the
    // JWKS endpoint FastAPI verifies against. Explicitly NOT a session
    // replacement: the browser session stays a cookie, and this is only for
    // calling the Python service.
    //
    // issuer and audience are set explicitly because the two token types this
    // service mints disagree by default, and the API has one setting for both.
    // This plugin defaults to the bare ORIGIN --
    //
    //     const defaultIss = options?.jwt?.issuer ?? baseURLOrigin;
    //
    // -- while the OAuth provider signs `iss` as `ctx.context.baseURL`, which
    // is the origin PLUS basePath. So a session JWT claimed
    // `https://host` while an access token claimed `https://host/auth`, and
    // AUTH_ISSUER could satisfy exactly one of them: set to the origin, MCP
    // connections were refused; set to the origin plus /auth, the web app was.
    // Both failures arrive as a bare 401 that names neither claim.
    //
    // Pinning both to the effective base makes one AUTH_ISSUER correct for
    // everything. Safe to change: these tokens live fifteen minutes and are
    // re-derived from the session cookie on demand, so nobody is signed out.
    jwt({
      jwt: {
        issuer: `${baseURL}${AUTH_BASE_PATH}`,
        audience: `${baseURL}${AUTH_BASE_PATH}`,
      },
    }),

    // MyGist as an OAuth 2.1 authorization server, so an MCP client connects by
    // signing in rather than by being handed a token.
    //
    // Gated on AUTH_MCP_RESOURCE, and not merely for tidiness. This plugin
    // registers /oauth2/register with allowUnauthenticatedClientRegistration,
    // so leaving it on unconditionally would hand an anonymous, row-creating
    // endpoint to every instance whose operator never asked for OAuth --
    // including ones that upgraded into it without reading a release note.
    // Fail closed: an instance that did not opt in gains no new surface, which
    // is the same rule the API container already follows with the same
    // variable.
    //
    // NOT accompanied by `disabledPaths: ["/token"]`, which both the OAuth and
    // JWT plugin docs recommend. Re-verified against the published package at
    // 1.7.1, by enumerating what each plugin actually registers: this one
    // registers /oauth2/token and never a bare /token. The bare one belongs to
    // the JWT plugin, so there is no collision -- and disabling it would break
    // the SPA, which exchanges its session cookie for a JWT there on every page
    // load.
    ...(MCP_RESOURCE
      ? [
          // One argument, since 1.7. This also took Better Auth's effective
          // base until then, for `validAudiences` -- an option 1.7 removed, and
          // the only thing that ever read it. See oauth.js.
          oauthPlugin({ mcpResource: MCP_RESOURCE }),

          // Without this, a client asking to redirect to loopback -- which
          // is every MCP client, and which this server documents as accepted --
          // is refused at registration by 1.7 for not having declared itself
          // native. See oauth.js.
          oauthRegistrationNativePlugin(createAuthMiddleware),

          // Revocation the plugin has no endpoint for (see the JSDoc above),
          // and meaningless without it -- so it comes and goes with the rest
          // of the OAuth surface rather than on its own.
          oauthRevokePlugin(),
        ]
      : []),

    // Sign in with Authentik. Inert unless AUTH_OIDC_DISCOVERY_URL is set.
    //
    // Registers NO endpoints -- that changed in 1.7. The plugin injects a
    // provider into context.socialProviders and the flow rides the core routes:
    // /sign-in/social, /callback/authentik, /link-social. The redirect URI to
    // configure on Authentik is therefore <origin>/auth/callback/authentik,
    // with no `oauth2` segment in it.
    //
    // Spread unconditionally, unlike the OAuth block above: that block gates
    // at this call site because oauthPlugin() needs MCP_RESOURCE handed to it
    // as an argument either way. ssoPlugins() needs nothing from this file --
    // it re-reads AUTH_OIDC_DISCOVERY_URL itself and returns [] when unset --
    // so the gate lives in sso.js, the one place that already has to know the
    // variable's name.
    //
    // Its init FETCHES the discovery document, so this service will not boot
    // while Authentik is unreachable. Deliberate: the alternatives are dropping
    // ID-token verification, or booting with SSO quietly off. A security
    // feature that disables itself is worse than one that fails in the deploy
    // log, which is where someone is already looking.
    ...ssoPlugins(),

    // Closed testing. Inert unless INVITE_ONLY is on, which no self-hosted
    // instance and no local dev environment turns on.
    invitePlugin(),
  ],
});
