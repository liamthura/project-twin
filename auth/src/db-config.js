/**
 * Turning one DATABASE_URL into a node-postgres pool config.
 *
 * This exists as its own module for one reason: it is the piece that was wrong
 * twice, and it cannot be tested through `auth.js` because that module demands
 * environment variables at import time. Pure function in, plain object out.
 *
 * The problem it solves: MyGist's Python half and its Node half share a single
 * DATABASE_URL, and the two stacks disagree about what `sslmode` means.
 *
 *   libpq (so psycopg, so the API)  `require` = encrypt, do not verify the chain
 *   node-postgres                    any TLS  = verify the chain
 *
 * Against a self-signed certificate -- which is what a Postgres sitting on an
 * internal network normally has -- the same string that works for the API fails
 * here with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 */

/**
 * libpq accepts two connection-string forms -- a URI, and keyword/value
 * ("host=h dbname=db sslmode=require") -- and node-postgres accepts only the
 * first. It does not reject the second: it takes the entire string as the
 * DATABASE NAME, then connects to a default host as the local user. Measured:
 *
 *   "host=h port=5432 dbname=db user=u"
 *     -> { host: "base", database: "host=h port=5432 dbname=db user=u" }
 *
 * That failure is worse than a crash, because the error it eventually produces
 * names a database nobody asked for. Catching it here is the difference between
 * one legible line at boot and a confusing hunt through Postgres logs.
 */
export function assertUri(connectionString) {
  try {
    new URL(connectionString);
  } catch {
    throw new Error(
      "DATABASE_URL must be a URI (postgres://user:password@host:5432/dbname).\n" +
        "  The keyword/value form that psql and libpq accept -- host=... dbname=... --\n" +
        "  is NOT understood by node-postgres: it would be taken as the database name\n" +
        "  and this service would connect somewhere unintended.",
    );
  }
}

/**
 * The sslmode a connection string asks for, defaulting to libpq's own default.
 */
export function sslModeOf(connectionString) {
  const fromUrl = new URL(connectionString).searchParams.get("sslmode");
  if (fromUrl) return fromUrl.toLowerCase();

  // A URI whose password contains an unencoded "#" parses, but the URL parser
  // treats everything after it as a fragment and loses the query -- so read the
  // raw string too rather than silently defaulting.
  const match = /[?&]sslmode=([a-z-]+)/i.exec(connectionString);
  return match ? match[1].toLowerCase() : "prefer";
}

/** The TLS settings libpq would apply for a given sslmode. */
export function sslForMode(mode) {
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

/**
 * Remove sslmode from the string, because passing it and an `ssl` option is a
 * contradiction that node-postgres resolves the wrong way round.
 *
 * ConnectionParameters does this, at pg/lib/connection-parameters.js:
 *
 *     config = Object.assign({}, config, parse(config.connectionString))
 *
 * The parsed string is the SECOND argument, so anything it sets WINS over what
 * the caller passed. A URI carrying `?sslmode=require` therefore arrives as
 * `ssl: {}` -- TLS on, verification at Node's default, which is on -- and the
 * `{rejectUnauthorized: false}` computed above is silently discarded. That is
 * why fixing the parser alone did not fix the connection: the answer was right
 * and then thrown away.
 *
 * Deleting the parameter is what makes the explicit option authoritative. It
 * loses nothing: sslModeOf has already read it, and `ssl` expresses the whole
 * decision.
 */
export function withoutSslMode(connectionString) {
  const url = new URL(connectionString);
  if (!url.searchParams.has("sslmode")) return connectionString;

  url.searchParams.delete("sslmode");
  // Drop a query string left empty, so the result is the same string a human
  // would have written.
  return url.toString().replace(/\?$/, "");
}

/**
 * The complete pool config. `options` pins every query to the auth schema:
 * Better Auth's table names are generic -- "user", "session", "account" -- and
 * in `public` they would sit beside MyGist's own `users` and `tokens`.
 */
export function poolConfig(connectionString) {
  assertUri(connectionString);

  return {
    connectionString: withoutSslMode(connectionString),
    ssl: sslForMode(sslModeOf(connectionString)),
    options: "-c search_path=better_auth",
  };
}
