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

// One pool, shared by Better Auth and the provisioning hook below. search_path
// pins Better Auth's own queries to its schema; the hook reaches into `public`
// by qualifying the table explicitly, which works regardless of search_path.
const databaseUrl = required("DATABASE_URL");

/**
 * TLS settings matching libpq's `sslmode`, which node-postgres does not follow.
 *
 * libpq -- and so psycopg, and so the Python half of MyGist -- reads
 * `sslmode=require` as "encrypt, do not verify"; only verify-ca and verify-full
 * check the chain. node-postgres instead verifies whenever ssl is on, so the
 * SAME connection string that works for the API fails here against a
 * self-signed certificate with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * Honouring libpq's meaning is what makes one DATABASE_URL work for both
 * services, which is the only sane arrangement when they share a database.
 */
function sslModeOf(connectionString) {
  // libpq accepts two forms and node-postgres accepts both: a URI, and
  // keyword/value ("host=... sslmode=require"). `new URL` throws on the second,
  // and this runs at module load -- so an unparseable string would crash the
  // process before the preflight could print anything useful, which is the
  // opposite of what that check is for.
  try {
    const fromUrl = new URL(connectionString).searchParams.get("sslmode");
    if (fromUrl) return fromUrl;
  } catch {
    // Not a URI. Fall through to the scan below.
  }

  // Also covers a URI whose password contains an unencoded "#", where the URL
  // parser silently treats the rest as a fragment and loses the query.
  const match = /[?&\s]sslmode=([a-z-]+)/i.exec(connectionString);
  return match ? match[1].toLowerCase() : "prefer";
}

function sslFromConnectionString(url) {
  const mode = sslModeOf(url);

  // verify-ca and verify-full ask for the chain to be checked.
  if (mode.startsWith("verify")) return { rejectUnauthorized: true };
  // require asks for encryption without verification -- the case that fails
  // against a self-signed certificate if you let node-postgres decide.
  if (mode === "require") return { rejectUnauthorized: false };
  // disable, allow, prefer (libpq's default). prefer means "try TLS, fall back
  // to plaintext", and node-postgres cannot negotiate that fallback: asking for
  // ssl against a server without it fails outright with "The server does not
  // support SSL connections". Plaintext is the behaviour that actually works
  // for both, and these connections do not leave the internal network.
  return false;
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslFromConnectionString(databaseUrl),
  options: "-c search_path=better_auth",
});

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
        after: async (user) => {
          await pool.query(
            `insert into public.users (id, username, created_at)
             values ($1, $2, now())
             on conflict (id) do nothing`,
            [user.id, user.username ?? user.name],
          );
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
