/**
 * Check the database is usable before serving a single request.
 *
 * Without this, a service whose DATABASE_URL points somewhere workable but
 * WRONG -- a different database, a role without rights on the schema -- starts
 * perfectly happily and then returns a bare 500 on everything that touches
 * Postgres. `/health` still says ok, because it touches nothing. The only
 * evidence is a stack trace inside the container, which is the least reachable
 * place to put it during a deploy.
 *
 * So the check runs at boot and, on failure, prints the three facts that
 * actually identify the problem -- which database, which role, which
 * search_path -- and exits non-zero. The platform's deployment log is where
 * someone is already looking.
 */

import { activeCount, inviteOnly } from "./invite.js";
import { mcpResource } from "./oauth.js";

// Every table migration 0003 creates. Missing any means this service is
// pointed at a database the API has not migrated.
const REQUIRED_TABLES = ["user", "session", "account", "verification", "jwks"];

export async function preflight(pool, auth) {
  let context = null;

  try {
    const { rows } = await pool.query(
      "select current_database() as db, current_user as role, " +
        "current_setting('search_path') as search_path",
    );
    context = rows[0];
  } catch (error) {
    console.error(
      "\n[preflight] Cannot connect to the database.\n" +
        `  ${error.message}\n\n` +
        "  DATABASE_URL is set (the service would not have started otherwise),\n" +
        "  so it is reachable-looking but wrong. Common causes, in the order they\n" +
        "  usually bite:\n\n" +
        "    - TLS. sslmode is honoured with libpq's meaning (see db-config.js),\n" +
        "      so `require` encrypts without checking the certificate chain and\n" +
        "      only `verify-ca`/`verify-full` check it. If the message above says\n" +
        "      UNABLE_TO_VERIFY_LEAF_SIGNATURE or SELF_SIGNED_CERT, DATABASE_URL\n" +
        "      is asking to verify a certificate that cannot be verified: use\n" +
        "      sslmode=require, or drop sslmode on an internal network.\n" +
        "    - Host. localhost inside this container is this container.\n" +
        "    - Role or database does not exist.\n",
    );
    return false;
  }

  // to_regclass returns null rather than raising for a missing relation, so one
  // query answers for all five without a try/catch per table.
  const { rows } = await pool.query(
    `select t.name, to_regclass('better_auth.' || quote_ident(t.name)) is not null as present
       from unnest($1::text[]) as t(name)`,
    [REQUIRED_TABLES],
  );

  const missing = rows.filter((r) => !r.present).map((r) => r.name);

  if (missing.length > 0) {
    console.error(
      "\n[preflight] The better_auth tables are not visible.\n\n" +
        `  missing:      ${missing.join(", ")}\n` +
        `  database:     ${context.db}\n` +
        `  role:         ${context.role}\n` +
        `  search_path:  ${context.search_path}\n\n` +
        "  These tables are created by the API's Alembic migration 0003, not by\n" +
        "  this service. Two things produce this:\n\n" +
        "    1. DATABASE_URL points at a DIFFERENT database from the API's, so\n" +
        "       the migration ran somewhere else. Compare both values -- host,\n" +
        "       role AND database name.\n" +
        "    2. The role above lacks USAGE on the better_auth schema, which the\n" +
        "       migration created as whichever role ran it.\n\n" +
        "  Check with:  psql -c \"select tablename from pg_tables " +
        "where schemaname='better_auth'\"\n",
    );
    return false;
  }

  console.log(
    `[preflight] database ${context.db} as ${context.role} — ` +
      `all ${REQUIRED_TABLES.length} better_auth tables visible`,
  );

  await reportInviteMode(pool);
  return await linkClientsToMcpResource(pool, auth);
}

/**
 * Give every existing OAuth client the `oauthClientResource` row that 1.7's
 * `enforcePerClientResources` default now requires of it.
 *
 * Better Auth 1.6 had no link table. Every client registered against this
 * instance before the 1.7 upgrade therefore has no link row and never could
 * have had one, and the 1.7 default refuses each of them at its next authorize
 * with `invalid_target` -- on the browser callback, with no operator remedy
 * short of telling everyone to reconnect. This is the step that makes keeping
 * that default a decision rather than a breakage. See oauth.js.
 *
 * Fatal when the resource row is missing, because with the default on there is
 * nothing an authorize request could succeed against: better to say so here,
 * naming the variable, than to serve a container where every connection fails.
 *
 * @returns false only when boot should be refused.
 */
async function linkClientsToMcpResource(pool, auth) {
  const resource = mcpResource();
  if (!resource) {
    // Same fail-closed rule as the rest of the OAuth surface: unset, the
    // plugins never register, there are no clients and no resource to link to.
    console.log("[oauth] AUTH_MCP_RESOURCE unset — no OAuth surface, nothing to link");
    return true;
  }

  // The `oauthResource` row is seeded by the plugin from its `resources`
  // option, and NOT by the time this runs: plugin init is async and auth.js
  // constructs `auth` at module load without awaiting it. Measured on a fresh
  // database -- 0 rows immediately after importing auth.js, 1 row after the
  // await below. `$context` is the public handle on that init, so awaiting it
  // is what makes the row exist.
  //
  // Never construct the row here instead. The plugin's seed is `insertOnly`,
  // so an identifier wrong by so much as a trailing slash is not corrected on
  // the next boot: it leaves two resource rows, every link pointing at the
  // dead one, and the same `invalid_target` this function exists to prevent.
  await auth.$context;

  const { rows } = await pool.query(
    'select 1 from better_auth."oauthResource" where "identifier" = $1',
    [resource],
  );
  if (rows.length === 0) {
    console.error(
      "\n[oauth] AUTH_MCP_RESOURCE names a resource this server has not " +
        "registered.\n\n" +
        `  AUTH_MCP_RESOURCE:  ${resource}\n\n` +
        "  The OAuth plugin seeds better_auth.\"oauthResource\" from this value at\n" +
        "  startup, and it has not appeared -- so the seed was skipped or\n" +
        "  refused. Every authorize request naming this resource will come back\n" +
        "    invalid_target: requested resource ... is not configured\n" +
        "  and no client can connect. Check the value is an absolute URI, and\n" +
        "  look above for an `oauth-provider: skipping resource seed` warning.\n",
    );
    return false;
  }

  const linked = await backfillClientResources(pool, resource);

  // Zero is the normal case twice over -- a fresh instance with no clients,
  // and every boot after the first. Said out loud regardless, because a silent
  // backfill cannot be told apart from one that did not run.
  console.log(
    `[oauth] ${resource} — ` +
      (linked === 0
        ? "every client already linked"
        : `linked ${linked} client${linked === 1 ? "" : "s"} that had no link row`),
  );
  return true;
}

/**
 * The backfill itself: one statement, no transaction, safe on every boot.
 *
 * Idempotency is the `not exists` rather than the `on conflict`, which can
 * only catch a primary-key collision -- there is no unique constraint on
 * (clientId, resourceId) in migration 0010 to conflict on. It is kept as the
 * cheap half of belt and braces.
 *
 * @returns how many link rows were created.
 */
export async function backfillClientResources(pool, resource) {
  const { rowCount } = await pool.query(
    `insert into better_auth."oauthClientResource" ("id", "clientId", "resourceId", "createdAt")
     select gen_random_uuid()::text, c."clientId", $1, now()
       from better_auth."oauthClient" c
      where not exists (
              select 1 from better_auth."oauthClientResource" r
               where r."clientId" = c."clientId" and r."resourceId" = $1
            )
     on conflict do nothing`,
    [resource],
  );
  return rowCount;
}

/**
 * Say whether the gate is on, and how many codes could actually admit someone.
 *
 * The count is the point. Turning invite-only on with nothing mintable locks
 * out every new account including your own, and there is no other moment where
 * that is visible -- the service starts, /health says ok, and the first person
 * to try discovers it. One line in the deploy log is cheaper than that.
 *
 * Never fatal. A missing table means the mode is off and migration 0005 has not
 * run, which is a perfectly ordinary state for an instance that does not use
 * this.
 */
async function reportInviteMode(pool) {
  if (!inviteOnly()) {
    console.log("[invite] invite-only OFF — anyone can create an account");
    return;
  }

  try {
    const active = await activeCount(pool);
    console.log(
      `[invite] invite-only ON — ${active} code${active === 1 ? "" : "s"} ` +
        `can currently admit someone`,
    );
    if (active === 0) {
      console.warn(
        "[invite] WARNING: no usable codes. Nobody can create an account " +
          "until one is minted:  python scripts/invite.py mint --label ...",
      );
    }
  } catch (error) {
    console.error(
      `[invite] invite-only is ON but the codes cannot be read: ${error.message}\n` +
        "  Migration 0005_invite_codes creates invite_codes. Until it has run,\n" +
        "  every sign-up will be refused.",
    );
  }
}
