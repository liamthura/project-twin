# Datadog APM, tracing and logs — design

Date: 2026-10-04
Status: draft

## Why

Liam runs Datadog at Honda and is building up APM and distributed tracing there.
MyGist is a codebase he owns end to end, so it's the place to practise: traces
he can read against code he wrote, logs he can jump to from a slow span, a
service map with more than one service on it.

There is no observability today. The backend logs plain text to stdout, the auth
service logs two `console.*` lines, and the Coolify log drain to New Relic is
switched off on every app.

Success: a request to `/mcp`, `/api/...` or `/auth/...` shows up in Datadog APM
as one flame graph, with its Postgres and outbound HTTP spans, tagged with the
right service, env and version, and every log line it wrote is one click away.

## Constraints

- **MyGist is self-hostable, and there is one image.** Datadog must be strictly
  opt-in. With no Datadog configuration the image behaves exactly as it does
  today: nothing loaded, no "cannot reach agent" warnings, plain-text logs.
- **The VPS has about 2.6 GiB free** (14 GiB, 4 cores, no swap). The Agent gets a
  hard memory limit.
- **Prod has other people's data on it.** Nothing that leaves the box may carry
  persona content, OAuth codes or credentials.
- **Account:** the Datadog Student Developer program (GitHub Student Pack):
  Infrastructure and APM for up to 10 hosts, 500 GB of ingested logs a month,
  for as long as the pack stays verified.

## Approach

Datadog's own libraries (`ddtrace` for Python, `dd-trace` for Node) with
auto-instrumentation, reporting to one Datadog Agent container on
`thuradev-main`. The Agent receives traces, tails the MyGist containers' stdout,
and collects host and container metrics as a side effect.

Rejected:

- **OpenTelemetry SDK into the Agent's OTLP receiver.** Vendor-neutral, but some
  Datadog-native features are weaker over OTLP, and it isn't the library Liam
  asked for or the model he works with.
- **Agentless.** Saves the Agent's memory, but APM traces need an Agent.

## API (`backend/`)

**Dependency.** `ddtrace==4.15.4` in `requirements.txt`, pinned exactly like
everything else there. It's in the image for every self-hoster (roughly
15-20 MB); a second image isn't worth that.

**The switch is `DD_AGENT_HOST`.** At the very top of `main.py`, before FastAPI,
psycopg or httpx are imported:

```python
import os

if os.getenv("DD_AGENT_HOST"):
    commit = os.getenv("APP_COMMIT") or os.getenv("SOURCE_COMMIT")
    if commit:
        os.environ.setdefault("DD_VERSION", commit)
    os.environ.setdefault("DD_HTTP_SERVER_TAG_QUERY_STRING", "false")
    os.environ.setdefault("DD_TRACE_HTTP_CLIENT_TAG_QUERY_STRING", "false")
    import ddtrace.auto  # noqa: F401 -- must precede every instrumented import
```

A gate in Python rather than `ddtrace-run` in the Dockerfile `CMD`, so the same
switch works under `uvicorn --reload` locally and the `CMD` is untouched.

What auto-instrumentation gives without further code:

- a `fastapi.request` span per request, MCP included (it is mounted on the same
  app)
- a span per psycopg query: the SQL text with `%s` placeholders, never the bound
  values
- httpx spans for the embeddings provider, TypeSafe and the auth proxy. The
  httpx integration injects trace headers, which is what joins the API's trace
  to auth's.

**Logs.** `server.py`'s `logging.basicConfig` stays as it is when the switch is
off. When it's on, the root handler gets a small stdlib JSON formatter (no new
dependency), one object per line:

| Field | From |
|---|---|
| `timestamp` | `record.created`, ISO 8601 |
| `level` | `record.levelname` (Datadog's status remapper reads `level`) |
| `logger` | `record.name` |
| `message` | `record.getMessage()` |
| `error.stack` | `formatException(record.exc_info)`, when there is one |
| `dd.trace_id`, `dd.span_id`, `dd.service`, `dd.env`, `dd.version` | added to the record by ddtrace's log injection (on by default since 3.10) |

Datadog's default pipeline remaps `dd.trace_id` to the trace, so logs and traces
link with no parsing rules.

uvicorn configures its own loggers (`uvicorn`, `uvicorn.access`) with their own
plain-text handlers and `propagate=False`, before it imports the app. When the
switch is on, `server.py` clears those handlers and sets `propagate=True`, so
access and error lines come out as JSON through the root handler.

## Auth (`auth/`)

**Dependency.** `dd-trace@6.19.0` in `dependencies`.

**The switch is `NODE_OPTIONS=--import dd-trace/initialize.mjs`**, Datadog's
documented setup for ESM apps. Unset, dd-trace is never loaded. No change to
`src/`.

**`auth/Dockerfile`** gains:

```dockerfile
ARG SOURCE_COMMIT
ENV DD_VERSION=$SOURCE_COMMIT
# dd-trace's default redaction misses OAuth's code= and state=; drop the whole
# query string. Inert unless dd-trace is loaded.
ENV DD_TRACE_OBFUSCATION_QUERY_STRING_REGEXP=.*
```

Auto-instrumentation gives an `http` server span per request, joined to the
API's trace through the injected headers, and a span per `pg` query.

**Not in scope:** log-trace correlation for auth. dd-trace injects into pino,
winston and bunyan, not `console`. Auth's few log lines still reach Datadog as
plain text, unlinked. Add pino if auth ever logs in earnest.

## The Agent

A Docker Compose resource in Coolify on `thuradev-main`, so it shows up next to
the apps, restarts with them and keeps its secret in Coolify:

```yaml
services:
  datadog-agent:
    image: datadog/agent:7
    mem_limit: 512m
    environment:
      - DD_API_KEY=${DD_API_KEY}
      - DD_SITE=${DD_SITE}
      - DD_HOSTNAME=thuradev-main
      - DD_APM_ENABLED=true
      - DD_APM_NON_LOCAL_TRAFFIC=true
      - DD_LOGS_ENABLED=true
      - DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true
      - DD_CONTAINER_EXCLUDE_LOGS=name:.*
      - DD_CONTAINER_INCLUDE_LOGS=<the four MyGist containers, by Coolify app uuid>
      - DD_PROCESS_AGENT_ENABLED=false
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /proc/:/host/proc/:ro
      - /sys/fs/cgroup/:/host/sys/fs/cgroup:ro
    networks:
      coolify:
        aliases: [datadog-agent]
networks:
  coolify:
    external: true
```

- Reachable from every app on the `coolify` network as `datadog-agent`, on
  `:8126` for traces. Not published to the host or the internet.
- Collects logs only from the prod and staging API and auth containers. Coolify,
  Traefik and Postgres are excluded, which keeps ingest small and keeps database
  logs off Datadog.
- `DD_API_KEY` and `DD_SITE` are entered in Coolify by Liam. EU1
  (`datadoghq.eu`) if the account is new.
- The include list is matched against real container names when the Agent is
  deployed. Coolify names containers by app uuid, and those names are checked
  with `docker ps`, not assumed.

## Per-app environment (unified service tagging)

| App | `DD_AGENT_HOST` | `DD_SERVICE` | `DD_ENV` | `NODE_OPTIONS` |
|---|---|---|---|---|
| staging API | `datadog-agent` | `mygist-api` | `staging` | |
| staging auth | `datadog-agent` | `mygist-auth` | `staging` | `--import dd-trace/initialize.mjs` |
| prod API | `datadog-agent` | `mygist-api` | `prod` | |
| prod auth | `datadog-agent` | `mygist-auth` | `prod` | `--import dd-trace/initialize.mjs` |

`DD_VERSION` comes from the commit stamp the images already carry. The auth apps
need Coolify's `include_source_commit_in_build` turned on (today it's on for the
API apps only), or their version reads empty.

## Testing

1. **Unit (pytest, `backend/tests/`).**
   - With `DD_AGENT_HOST` unset, importing `main` leaves `ddtrace` out of
     `sys.modules` and the root formatter is the plain-text one.
   - The JSON formatter emits one valid JSON object per record, copies `dd.*`
     fields when the record has them, omits them when it doesn't, and includes
     `error.stack` for `logger.exception`.
2. **Local end to end, no Datadog account needed.** Run Datadog's
   `dd-apm-test-agent` on the `backend_default` network, start
   `scripts/local-preview.sh` and the auth container with the env above pointed
   at it, sign in, call one `/api` endpoint and one MCP tool, then read the
   captured traces back from the test agent. Pass means:
   - one trace id covers `mygist-api` and `mygist-auth` on the sign-in request
   - Postgres spans are present, with placeholders and no values
   - no `http.url` tag on either service carries a query string
   - the API's stdout is JSON carrying the same `dd.trace_id`
3. **Staging.** Deploy the Agent, set the staging rows of the table, redeploy.
   Liam checks in the Datadog UI: the service map shows `mygist-api` →
   `mygist-auth` → Postgres, a flame graph renders, and a log line jumps to its
   trace.
4. **Prod.** The same env flip on the prod rows, after staging has passed.

## Rollback

Unset `DD_AGENT_HOST` (and `NODE_OPTIONS` on auth) and restart. The image goes
back to today's behaviour. Stopping the Agent resource removes the rest.

## Out of scope

RUM, the continuous profiler, Database Monitoring, source code links
(`DD_GIT_*`), monitors and dashboards. Each is its own switch once traces and
logs are flowing, and the dashboards and monitors are Liam's to build in the UI.
