# Better Auth 1.7.1 schema reference

Input for Alembic revision `0010_better_auth_17`. Two files, because the
obvious tool does not work at this version.

## `better_auth_1.7_fields.txt` — authoritative

Every table and field better-auth 1.7.1 declares for THIS project's plugin set,
as `table|field|type|req/opt|uniq|->fk|hasDefault`. Produced from the public
`getAuthTables` API against `auth/src/auth.js`:

```js
import { getAuthTables } from "better-auth/db";
const { auth } = await import("./src/auth.js");
getAuthTables(auth.options);   // AUTH_MCP_RESOURCE must be set, or the OAuth plugins are absent
```

Regenerate this way. Do not use `@better-auth/cli`.

## `better_auth_1.7_cli_partial.sql` — plugin tables only, kept as cross-check

`@better-auth/cli` hard-pins its own `better-auth` dependency — `latest` is
1.4.22, which depends on `better-auth@1.4.22`, and the newest release of any
tag (`1.5.0-beta.13`) pins `1.5.0-beta.13`. Its diff engine is imported by bare
specifier and always resolves to that vendored copy, never the target project's
1.7.1.

The consequence is a file that looks complete and is not: PLUGIN tables come
out correct, because their schemas are declared on the plugin objects loaded
from our own config, while CORE tables (`user`, `session`, `account`,
`verification`) come from the CLI's stale 1.4.22 copy. `account.issuer` — the
one 1.7 change with a data step — is silently absent.

`getMigrations`, the function that would emit it, is no longer re-exported from
better-auth 1.7.1's public `./db` entry point either. Tool and library have
drifted apart at this version.
