# Watcher

The watcher is an always-on agent you run for your own name. On every check it:

- fingerprints your official site (the `url` record) against `org.copeybara.site`;
- probes the look-alike URLs you configured;
- sets `org.copeybara.status` and adds serving look-alikes to `org.copeybara.blocklist`.

Extensions that follow your name act on those records, and can block your site before it loads.

## Run it from the config

```bash
pnpm copeybara watcher        # writes .copeybara/watcher/compose.yml + watcher.env.example
cp .copeybara/watcher/watcher.env.example .copeybara/watcher/watcher.env   # set WATCHER_KEY
pnpm copeybara watcher --up   # docker compose up -d --build
```

The generated service:

- builds `apps/watcher/Dockerfile` from the Copeybara repo; it runs as a non-root user with a read-only filesystem and `no-new-privileges`;
- gets `WATCH_NAMES`, `RPCS`, `INTERVAL_MS`, `CANDIDATES` and `WATCHER_ADDRESS` from your config;
- reads `WATCHER_KEY` only from `watcher.env`, which the generated `.gitignore` excludes;
- **refuses to start** if `WATCHER_KEY` is not the `watcher.key` address in your config;
- has a Docker `HEALTHCHECK` on `/healthz`: healthy while checks complete, unhealthy after four missed intervals.

## Environment

| Variable | Meaning |
|---|---|
| `WATCHER_KEY` | the watcher's key; it should hold only the status and blocklist setter roles |
| `WATCH_NAMES` | comma-separated ENS names |
| `WATCHER_ADDRESS` | refuse to start unless the key is this address |
| `CANDIDATES` | look-alike URLs: `name=url,url;name2=url` |
| `RPCS` / `WRITE_RPC` | read RPCs (comma-separated) and the RPC for its writes |
| `INTERVAL_MS` | default 15000 |
| `STATUS_PORT`, `STATUS_HOST` | `GET /status` (JSON state) and `GET /healthz`; host defaults to 127.0.0.1 |
| `ANTHROPIC_API_KEY` | optional: Claude writes the short warning note from structured facts only |

## What it decides

| Observation | Action |
|---|---|
| 2 fingerprint mismatches in a row | `status=compromised`: extensions block the site before it loads |
| 3 failed fetches in a row | `status=degraded` |
| 5 clean checks in a row | clears an alarm **it** raised |
| a look-alike URL serves pages | adds its host to the blocklist |

A `compromised` status set by your Safe stays until the Safe clears it; the watcher never overrides it.

## Its key

The watcher key gets argument-scoped resolver roles for exactly two records (`copeybara propose` adds the grants). `copeybara roles-check` proves it cannot write the release, manifest, exits, site, extension or `url`, cannot grant itself roles and cannot upgrade the resolver. A stolen watcher key can only raise or clear warnings; it can never block an exit.

Revoke it with one Safe transaction: `contracts/script/watcher-role.sh revoke`. The watcher notices, stops writing, and resumes when the roles are granted again.
