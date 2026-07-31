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
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { username } from "better-auth/plugins";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

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

export const auth = betterAuth({
  baseURL,

  // Mounted at /auth, matching what FastAPI forwards. The proxy passes the
  // path through unchanged, so both sides must agree on this prefix.
  basePath: "/auth",

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
  database: new Pool({
    connectionString: required("DATABASE_URL"),
    options: "-c search_path=better_auth",
  }),

  trustedOrigins: [baseURL],

  emailAndPassword: {
    enabled: true,

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
    jwt(),
  ],
});
