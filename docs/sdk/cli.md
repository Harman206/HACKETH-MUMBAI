# CLI reference

```bash
pnpm copeybara <command> [--config copeybara.config.ts]
```

Every command except `init`, `adapter new` and `drill --sample` reads the [config](configuration.md). Outputs go to `.copeybara/` (or `out`). Every read of ENS goes through three RPCs at a pinned block. **Nothing here signs:** the CLI writes files; your Safe owners sign on their own devices.

| Command | What it does | Writes | Fails when |
|---|---|---|---|
| `init [--force]` | writes a `copeybara.config.ts` to fill in | `copeybara.config.ts` | the file exists (without `--force`) |
| `manifest [--onchain]` | builds `org.copeybara.manifest` and `org.copeybara.exits` from `chains` and `exits` | `manifest.txt`, `exits.txt` | a function is banned, not canonical, missing from the ABI or (`--onchain`) from the bytecode; a spec role and kind don't match |
| `release` | hashes the kit (and extension) | `release.txt`, `extension.txt` | the kit has other than one inline script, no CSP pinning it by hash, or loads anything remote |
| `fingerprint --dist d` / `--url u` | hashes every script the site runs | `site.txt` | a third-party script has no matching `integrity` |
| `propose` | one Safe batch for every changed record plus missing scoped grants | `safe-batch.json`, `safe-tx.json` | the name resolves through another resolver; a call is outside the [batch scope](safe-proposals.md) |
| `verify` | reads every record and role back and compares with local files | none | any MISMATCH or problem |
| `certify` | `verify` plus the [certification](certification.md) checks and the last drill | `certification.json` | any ✗ |
| `roles-check [--live]` | proves the website and watcher keys can't write anything else; fork by default, `--live` uses `eth_call` on Sepolia | none | a forbidden write would succeed, or a Safe positive control fails |
| `drill [--sample]` | [fire drill](drill.md) on anvil forks with the site and primary RPC off | `drill.json` | a position isn't recovered |
| `incident --state s` | one Safe batch setting `org.copeybara.status` and the blocklist | `incident-batch.json` | `s` isn't `ok`, `degraded` or `compromised` |
| `watcher [--up]` | Docker Compose for the [watcher](watcher.md) | `watcher/compose.yml`, `watcher/watcher.env.example`, `watcher/.gitignore` | `--up` and Docker fails |
| `adapter new <name>` | scaffolds a code adapter with fork tests, Guard corpus cases and property tests | `packages/adapters/src/<name>.ts` and its tests (run inside the Copeybara repo) | a file already exists |

## Flags

| Flag | Command | Meaning |
|---|---|---|
| `--config <file>` | all | config path (default `copeybara.config.ts`) |
| `--onchain` | manifest | also check selectors against deployed bytecode |
| `--offline` | propose | don't read ENS; propose everything |
| `--no-grants` | propose | records only, no role grants |
| `--nonce <n>` | propose | Safe nonce for `safe-tx.json` |
| `--site <record>` | propose | use this site record instead of `site.txt` |
| `--api --sender <owner> --signature <sig>` | propose | post to `safeTxService` with an owner signature made elsewhere |
| `--dist <dir>` / `--url <url>` | fingerprint | what to fingerprint |
| `--live` | roles-check | check the real resolver instead of a fork |
| `--sample` | drill | built-in ERC-4626 sample, no config |
| `--state <s>` | incident | `ok`, `degraded` or `compromised` |
| `--note "<text>"` | incident | plain-language note, ≤ 200 characters |
| `--block <host>` / `--unblock <host>` | incident | repeatable; merged with the live blocklist |
| `--up` | watcher | start it with `docker compose up -d --build` |

## Exit codes

`0` when everything checked out, `1` otherwise. Every failure prints a plain sentence saying what to fix.
