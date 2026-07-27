"""Alembic environment.

The application talks to Postgres through psycopg 3 directly; SQLAlchemy is
present only because Alembic requires it. Two consequences:

1. The URL needs the psycopg 3 dialect spelled out. A bare `postgresql://`
   URL makes SQLAlchemy reach for psycopg2, which is not installed.
2. There are no ORM models, so `target_metadata` is None and autogenerate is
   unavailable by design. Migrations are hand-written SQL via `op.execute()`,
   which matches how the rest of the codebase talks to the database.
"""
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    # disable_existing_loggers defaults to True, which would switch off every
    # logger the application had already configured -- pack_loader's skipped-
    # manifest warnings among them. Migrations must not reconfigure logging
    # for the process that invoked them.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# No ORM models -- see the module docstring.
target_metadata = None


def _database_url() -> str:
    """DATABASE_URL, rewritten for the psycopg 3 dialect."""
    url = os.environ["DATABASE_URL"]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def _escaped_url() -> str:
    """The URL, safe to hand to ConfigParser.

    alembic.ini is read with ConfigParser interpolation, which treats '%' as
    a token. Percent-encoded characters in a password (a URL-encoded '@' or
    '/' is common) would otherwise raise or silently corrupt the DSN.
    """
    return _database_url().replace("%", "%%")


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade --sql`)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    config.set_main_option("sqlalchemy.url", _escaped_url())
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
