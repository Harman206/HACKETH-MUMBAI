# Overview

Copeybara gives your users a way to withdraw that does not depend on your website, your DNS or your RPC provider. Users keep a single HTML file, the **exit kit**. They check its sha256 against your **ENS name** and withdraw straight from your contracts, even when your site is down or serving a drainer.

The **Copeybara SDK** is what a protocol team uses to set that up and keep it correct. It publishes the right records to your ENS name, proves on a fork that the exit works with your site switched off, and gets you the **Copeybara certified** tick.

## What you publish

Everything users rely on lives in text records on your ENS name (ENSv2 on Sepolia today), written by your Safe:

| Record | What it says |
|---|---|
| `org.copeybara.release` | the sha256 and version of the exit kit users should run |
| `org.copeybara.manifest` | which of your contracts the kit may call, and which functions |
| `org.copeybara.exits` | optional: how to find and exit positions in your own contracts, without adapter code |
| `org.copeybara.site` | the hashes of every script your official website runs |
| `org.copeybara.extension` | the sha256 of the browser extension build |
| `org.copeybara.status`, `org.copeybara.blocklist` | incident state and look-alike domains, written by your watcher or Safe |

Full formats: [ENS records](ens-records.md).

## What the SDK contains

| Package | Use it to |
|---|---|
| `@copeybara/protocol-cli` | build records, propose them as one Safe batch, read them back, prove key scopes, run the drill, get certified ([CLI reference](cli.md)) |
| `@copeybara/vite-plugin`, `@copeybara/next-plugin`, `@copeybara/webpack-plugin` | fingerprint your site at build time and fail on unpinned third-party scripts ([Site fingerprint](site-fingerprint.md)) |
| `@copeybara/widget` | show users where the verified kit is, with one dependency-free file ([Widget](widget.md)) |
| `apps/watcher` | watch your site and look-alike domains, raise the alarm on ENS ([Watcher](watcher.md)) |

## How the pieces fit

```text
 your repo                         your Safe (2-of-3+)            your users
 ─────────                         ───────────────────            ──────────
 copeybara.config.ts ──► copeybara propose ──► safe-batch.json ──► owners sign
                                                     │
                                                     ▼
                                      ENS name: release · manifest · exits · site
                                                     │
          watcher ──► status · blocklist ────────────┤
                                                     ▼
                              exit kit (saved HTML) + extension read ENS through 3 RPCs
                                                     │
                                                     ▼
                                    withdraw straight from your contracts
```

## Ground rules

- **The SDK never holds a key.** Every ENS write is a Safe proposal. The only keys in the system are a website key that may write `url` and a watcher key that may write `status` and `blocklist`.
- **The Exit Guard is fail-closed.** Every transaction the kit sends must target a manifest contract, call only allowed functions, pay only the user, and carry no ETH, approval, permit or transfer. There is no override.
- **Status can never block an exit.** `status` and `blocklist` only make extensions warn about or block websites.

Next: [Quick start](quickstart.md), or hand the job to your coding agent: [Build with an AI agent](agents.md).
