"""Better Auth 1.7's schema changes.

Derived from better-auth 1.7.1's own `getAuthTables` against this project's
plugin set -- the field list is committed at
docs/superpowers/plans/notes/better_auth_1.7_fields.txt, with the reasoning for
not using `@better-auth/cli` in the README beside it. Regenerate rather than
hand-edit if the plugin set changes.

The account identity change is the only one with a data step. 1.7 keys an
account on (issuer, accountId) instead of (providerId, accountId), and the
generated migration deliberately refuses to choose issuers for you. Every
account this database has today is a credential account written by
scripts/seed_better_auth.py or by sign-up, so there is exactly one issuer to
assign and no collision to resolve: accountId is a uuid primary key.

Add nullable, backfill, then constrain. Adding the column NOT NULL in one step
would fail against any database that already has rows -- which is every
database this will ever run against.

Six oauth columns 0006 made `not null` are declared optional by 1.7. Where the
value has a right answer they keep NOT NULL and gain 0003's `current_timestamp`
default; `expiresAt`, where inventing one would backdate or extend a token,
drops the constraint instead. Same reasoning for `oauthAccessToken."token"`,
which 1.7 leaves empty for access tokens it issues as JWTs.

`oauthResource`, `oauthClientResource` and `oauthClientAssertion` are created
even though MyGist uses neither protected resources nor private_key_jwt client
assertions. Better Auth's adapter queries every table it declares regardless of
whether the feature is switched on, so a missing one surfaces as a runtime
failure part-way through the MCP OAuth flow. Three empty tables cost nothing.

Revision ID: 0010_better_auth_17
Revises: 0009_history_and_reads
"""
from alembic import op

revision = "0010_better_auth_17"
down_revision = "0009_history_and_reads"
branch_labels = None
depends_on = None

CREDENTIAL_ISSUER = "local:credential"

# Columns 1.7 adds to tables 0003 and 0006 already created. `string` -> text,
# `date` -> timestamptz, `number` -> integer, and the array/json-valued fields
# -> jsonb, matching how 0006 already stores `scopes` and `redirectUris`.
NEW_COLUMNS = {
    "jwks": [
        ('"alg"', "text"),
        ('"crv"', "text"),
    ],
    "oauthClient": [
        ('"clientDiscoveryId"', "text"),
        ('"clientCredentialsScopes"', "jsonb"),
        ('"backchannelLogoutUri"', "text"),
        ('"backchannelLogoutSessionRequired"', "boolean"),
        ('"applicationType"', "text"),
        ('"jwks"', "text"),
        ('"jwksUri"', "text"),
        ('"dpopBoundAccessTokens"', "boolean"),
    ],
    "oauthRefreshToken": [
        ('"authorizationCodeId"', "text"),
        ('"resources"', "jsonb"),
        ('"requestedUserInfoClaims"', "jsonb"),
        ('"rotatedAt"', "timestamptz"),
        ('"rotationReplayResponse"', "text"),
        ('"rotationReplayExpiresAt"', "timestamptz"),
        ('"confirmation"', "jsonb"),
    ],
    "oauthAccessToken": [
        ('"authorizationCodeId"', "text"),
        ('"resources"', "jsonb"),
        ('"requestedUserInfoClaims"', "jsonb"),
        ('"revoked"', "timestamptz"),
        ('"confirmation"', "jsonb"),
    ],
    "oauthConsent": [
        ('"resources"', "jsonb"),
        ('"requestedUserInfoClaims"', "jsonb"),
    ],
}

# Six columns 1.7 declares optional that 0006 made `not null` with no default.
# Same req -> opt signal acted on for `oauthAccessToken."token"` below, and a
# NOT NULL violation raised inside better-auth's adapter is a 500 part-way
# through the token or consent endpoint, against real clients.
#
# They are split because only one group has a right answer. A row created now
# was created now, so `createdAt`/`updatedAt` keep NOT NULL and gain the default
# 0003 already gives the core tables. There is no correct expiry to invent, so
# `expiresAt` drops the constraint rather than take a default that would
# silently backdate or extend a token's life.
TIMESTAMP_DEFAULTS = [
    ("oauthRefreshToken", '"createdAt"'),
    ("oauthAccessToken", '"createdAt"'),
    ("oauthConsent", '"createdAt"'),
    ("oauthConsent", '"updatedAt"'),
]
RELAXED_EXPIRIES = [
    ("oauthRefreshToken", '"expiresAt"'),
    ("oauthAccessToken", '"expiresAt"'),
]


def upgrade() -> None:
    op.execute(
        'alter table better_auth."account" add column if not exists "issuer" text'
    )

    # Only ever touches rows the previous run left behind, so a re-run over a
    # database that is already migrated is a no-op rather than a rewrite.
    op.execute(
        f"""
        update better_auth."account"
           set "issuer" = '{CREDENTIAL_ISSUER}'
         where "issuer" is null
           and "providerId" = 'credential'
        """
    )

    # Anything that is not a credential account has no issuer this migration
    # can invent. There are none today; failing loudly beats inventing one.
    op.execute(
        """
        do $$
        begin
          if exists (select 1 from better_auth."account" where "issuer" is null) then
            raise exception 'account rows with no issuer remain; backfill them before upgrading';
          end if;
        end $$
        """
    )

    op.execute(
        'alter table better_auth."account" alter column "issuer" set not null'
    )
    op.execute(
        'create unique index if not exists "account_issuer_accountId_uidx"'
        ' on better_auth."account" ("issuer", "accountId")'
    )

    for table, columns in NEW_COLUMNS.items():
        for name, type_ in columns:
            op.execute(
                f'alter table better_auth."{table}"'
                f" add column if not exists {name} {type_}"
            )

    # 1.7 stops storing an opaque value for access tokens it issues as JWTs
    # (`token` is declared optional now, where 1.6 declared it required). The
    # NOT NULL 0006 generated would reject those inserts at runtime.
    op.execute(
        'alter table better_auth."oauthAccessToken"'
        ' alter column "token" drop not null'
    )

    for table, column in TIMESTAMP_DEFAULTS:
        op.execute(
            f'alter table better_auth."{table}"'
            f" alter column {column} set default current_timestamp"
        )
    for table, column in RELAXED_EXPIRIES:
        op.execute(
            f'alter table better_auth."{table}" alter column {column} drop not null'
        )

    op.execute(
        'create index if not exists "oauthRefreshToken_authorizationCodeId_idx"'
        ' on better_auth."oauthRefreshToken" ("authorizationCodeId")'
    )
    op.execute(
        'create index if not exists "oauthAccessToken_authorizationCodeId_idx"'
        ' on better_auth."oauthAccessToken" ("authorizationCodeId")'
    )

    op.execute(
        """
        create table if not exists better_auth."oauthResource" (
            "id" text not null primary key,
            "identifier" text not null unique,
            "name" text not null,
            "accessTokenTtl" integer,
            "refreshTokenTtl" integer,
            "signingAlgorithm" text,
            "signingKeyId" text,
            "allowedScopes" jsonb,
            "customClaims" jsonb,
            "dpopBoundAccessTokensRequired" boolean,
            "disabled" boolean,
            "createdAt" timestamptz,
            "updatedAt" timestamptz,
            "policyVersion" integer,
            "metadata" jsonb
        )
        """
    )

    op.execute(
        """
        create table if not exists better_auth."oauthClientResource" (
            "id" text not null primary key,
            "clientId" text not null references better_auth."oauthClient" ("clientId") on delete cascade,
            "resourceId" text not null references better_auth."oauthResource" ("identifier") on delete cascade,
            "metadata" jsonb,
            "createdAt" timestamptz
        )
        """
    )

    op.execute(
        """
        create table if not exists better_auth."oauthClientAssertion" (
            "id" text not null primary key,
            "expiresAt" timestamptz not null
        )
        """
    )

    op.execute(
        'create index if not exists "oauthClientResource_clientId_idx"'
        ' on better_auth."oauthClientResource" ("clientId")'
    )
    op.execute(
        'create index if not exists "oauthClientResource_resourceId_idx"'
        ' on better_auth."oauthClientResource" ("resourceId")'
    )


def downgrade() -> None:
    for table in ("oauthClientResource", "oauthClientAssertion", "oauthResource"):
        op.execute(f'drop table if exists better_auth."{table}" cascade')

    op.execute(
        'drop index if exists better_auth."oauthAccessToken_authorizationCodeId_idx"'
    )
    op.execute(
        'drop index if exists better_auth."oauthRefreshToken_authorizationCodeId_idx"'
    )

    for table, columns in NEW_COLUMNS.items():
        for name, _type in columns:
            op.execute(
                f'alter table better_auth."{table}" drop column if exists {name}'
            )

    for table, column in TIMESTAMP_DEFAULTS:
        op.execute(
            f'alter table better_auth."{table}" alter column {column} drop default'
        )

    # The two NOT NULLs this revision dropped stay dropped. Re-adding either
    # would fail against any 1.7 row written without the value -- an access
    # token issued as a JWT, or a token 1.7 gave no expiry -- and a nullable
    # column breaks nothing for 1.6.

    op.execute('drop index if exists better_auth."account_issuer_accountId_uidx"')
    op.execute('alter table better_auth."account" drop column if exists "issuer"')
