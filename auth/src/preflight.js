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

// Every table migration 0003 creates. Missing any means this service is
// pointed at a database the API has not migrated.
const REQUIRED_TABLES = ["user", "session", "account", "verification", "jwks"];

export async function preflight(pool) {
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
  return true;
}
