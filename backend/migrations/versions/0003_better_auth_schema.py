"""Better Auth's tables, in their own schema.

Two decisions are embedded here.

**One migration system.** Better Auth ships a CLI that can create and migrate
its own tables. Using it would mean two tools writing DDL to one database, with
no shared ordering and no shared review. The CLI is used at development time to
GENERATE this SQL (`npm run schema:generate` in auth/), and the output is
committed here as an ordinary revision. Alembic stays the only thing that
touches the schema in any environment, which is the existing convention:
versioned, ordered, hand-written, reviewable.

**Its own Postgres schema.** Better Auth's table names are generic -- `user`,
`session`, `account`, `verification`. In `public` they would sit beside MyGist's
`users`, `tokens` and `persona_data`, and `public.user` next to `public.users`
is a genuine trap for anyone reading the database later. They go in
`better_auth`, and the service's connection pool sets `search_path` to match.

Revision ID: 0003_better_auth_schema
Revises: 0002_token_expiry

NOTE ON ORDERING: a `0003_proposals` revision is in flight on another branch,
also chained off 0002. Two revisions with the same number are two Alembic heads
and `upgrade head` refuses to pick between them. Whichever of the two lands on
main second must be renumbered and re-chained onto the first -- this one is
self-contained and touches no shared table, so re-chaining it is a two-line
change to `revision` and `down_revision`.
"""
from alembic import op

revision = "0003_better_auth_schema"
down_revision = "0002_token_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("create schema if not exists better_auth")

    # Verbatim from `@better-auth/cli generate` against the config in
    # auth/src/auth.js (better-auth 1.6.23, with the username and jwt plugins),
    # schema-qualified and made idempotent. Regenerate rather than hand-edit if
    # the plugin set changes.
    op.execute(
        """
        create table if not exists better_auth."user" (
            "id" text not null primary key,
            "name" text not null,
            "email" text not null unique,
            "emailVerified" boolean not null,
            "image" text,
            "createdAt" timestamptz default current_timestamp not null,
            "updatedAt" timestamptz default current_timestamp not null,
            "username" text unique,
            "displayUsername" text
        )
        """
    )

    op.execute(
        """
        create table if not exists better_auth."session" (
            "id" text not null primary key,
            "expiresAt" timestamptz not null,
            "token" text not null unique,
            "createdAt" timestamptz default current_timestamp not null,
            "updatedAt" timestamptz not null,
            "ipAddress" text,
            "userAgent" text,
            "userId" text not null references better_auth."user" ("id") on delete cascade
        )
        """
    )

    # Passwords live here, not on "user": Better Auth models credentials as one
    # account among several, so a password is the `credential` provider's row.
    # Seeding an existing MyGist account therefore writes two rows, and the
    # bcrypt hash goes in this table.
    op.execute(
        """
        create table if not exists better_auth."account" (
            "id" text not null primary key,
            "accountId" text not null,
            "providerId" text not null,
            "userId" text not null references better_auth."user" ("id") on delete cascade,
            "accessToken" text,
            "refreshToken" text,
            "idToken" text,
            "accessTokenExpiresAt" timestamptz,
            "refreshTokenExpiresAt" timestamptz,
            "scope" text,
            "password" text,
            "createdAt" timestamptz default current_timestamp not null,
            "updatedAt" timestamptz not null
        )
        """
    )

    op.execute(
        """
        create table if not exists better_auth."verification" (
            "id" text not null primary key,
            "identifier" text not null,
            "value" text not null,
            "expiresAt" timestamptz not null,
            "createdAt" timestamptz default current_timestamp not null,
            "updatedAt" timestamptz default current_timestamp not null
        )
        """
    )

    # The signing keypair for the JWTs FastAPI verifies. Persisted rather than
    # held in memory, which is what lets the service restart without
    # invalidating every token in flight -- and what lets more than one replica
    # agree on the keys.
    op.execute(
        """
        create table if not exists better_auth."jwks" (
            "id" text not null primary key,
            "publicKey" text not null,
            "privateKey" text not null,
            "createdAt" timestamptz not null,
            "expiresAt" timestamptz
        )
        """
    )

    op.execute(
        'create index if not exists "session_userId_idx" on better_auth."session" ("userId")'
    )
    op.execute(
        'create index if not exists "account_userId_idx" on better_auth."account" ("userId")'
    )
    op.execute(
        'create index if not exists "verification_identifier_idx" '
        'on better_auth."verification" ("identifier")'
    )


def downgrade() -> None:
    # The whole schema, since nothing outside it references these tables --
    # the link to public.users is by shared id value, deliberately not a
    # foreign key, so that neither store can block the other's migrations.
    op.execute("drop schema if exists better_auth cascade")
