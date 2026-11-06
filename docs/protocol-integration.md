# Integrating Copeybara: a guide for protocol teams

Copeybara gives your users a way out that does not depend on your website, your DNS or your RPC. They keep a single HTML **exit kit**, check its sha256 against your **ENS name**, and withdraw straight from your contracts. This guide covers the SDK that sets it up: [`packages/protocol-cli`](../packages/protocol-cli), the build plugins, the [`<copeybara-exit>` widget](../packages/widget/copeybara-exit.js), the [watcher](../apps/watcher) and Copeybara certified.

The same material, with the real output of each command, is on the website's Developers page (`#/developers`).

## Quick start (about an hour)

You need: an ENSv2 name on Sepolia owned by your Safe (2-of-3 or more) with a PermissionedResolver ([`contracts/script/SetupName.s.sol`](../contracts/script/SetupName.s.sol) does this), Node 22 and pnpm 9. The packages are not on npm yet; run them from this repository.

```bash
corepack enable && pnpm install
pnpm copeybara init                       # writes copeybara.config.ts
```

1. **Describe your protocol** in `copeybara.config.ts`: the ENS name, the Safe, the resolver, the website key (it may write `url` only), the watcher key (it may write `status` and `blocklist` only), the kit file and your exit contracts per chain. [`examples/demoswap/copeybara.config.ts`](../examples/demoswap/copeybara.config.ts) is the live Sepolia demo written this way.
2. **Build the records.** Each command refuses what the Exit Guard could not check.
   ```bash
   pnpm copeybara manifest --onchain       # org.copeybara.manifest (+ org.copeybara.exits)
   pnpm copeybara release                  # org.copeybara.release (+ org.copeybara.extension)
   pnpm copeybara fingerprint --dist dist  # org.copeybara.site; fails on an unpinned third-party script
   ```
3. **Propose one Safe batch.** `pnpm copeybara propose` writes `.copeybara/safe-batch.json`: every changed record and the two scoped grants, nothing else. In Safe{Wallet}, open Transaction Builder and drag the file in; your owners sign on their own devices. With `--api --sender 0x… --signature 0x…` the CLI posts it to the Safe Transaction Service using a signature made elsewhere.
4. **Prove it.**
   ```bash
   pnpm copeybara verify                   # every record read back through 3 RPCs; exit 1 on any ✗
   pnpm copeybara roles-check --live       # forbidden writes revert, the same writes as the Safe succeed
   pnpm copeybara drill                    # fork, switch off site + primary RPC, exit a seeded position
   ```
5. **Ship it to users:** add a build plugin, put the widget on your site, start the watcher (`pnpm copeybara watcher --up`).
6. **Get certified:** `pnpm copeybara certify` writes `.copeybara/certification.json`. Send it to us; we add your name to [`config/certified.json`](../config/certified.json).

## Trust model

| | |
|---|---|
| **Trusted** | the user's wallet and its broadcast RPC, Ethereum, the ENS contracts, your Safe's signers |
| **Verified, not trusted** | the kit file (sha256 against ENS), every RPC answer (3-path quorum at a pinned block), every exit call (the Exit Guard) |
| **Not trusted at all** | your website, its DNS, its third-party scripts, wherever the kit is hosted, the Copeybara website |

The SDK fits into that model:

- **It never holds a key.** Nothing in the SDK asks for, stores or uses a Safe owner key; every record write is a Safe proposal. [`packages/protocol-cli/test/no-keys.test.ts`](../packages/protocol-cli/test/no-keys.test.ts) scans the SDK packages for key and signing APIs. The only keys anywhere are the website key (`url`) and the watcher key (`status`, `blocklist`), each with argument-scoped resolver roles.
- **The batch cannot escalate.** Before a batch is written, [`assertBatchScope`](../packages/protocol-cli/src/propose.ts) decodes every call: Copeybara `setText` on your name, or one of the two scoped grants. Root roles, upgrades and other names are refused.
- **Protocol addresses come only from your ENS manifest.** The kit has no protocol addresses in it.
- **status and blocklist can never block an exit.** They only make extensions warn about or block websites.
- **The widget and the plugins are inert.** The widget makes no requests, calls no wallet method and stores nothing ([`packages/widget/e2e/widget.spec.ts`](../packages/widget/e2e/widget.spec.ts)). The plugins write a file and a CI summary; they never publish.

## Key capabilities

### ENS records

| Key | Written by | Built by |
|---|---|---|
| `org.copeybara.release` | Safe | `copeybara release` |
| `org.copeybara.manifest` | Safe | `copeybara manifest` |
| `org.copeybara.exits` | Safe | `copeybara manifest` (from `exits` in the config) |
| `org.copeybara.site` | Safe | `copeybara fingerprint` or a build plugin |
| `org.copeybara.extension` | Safe | `copeybara release` (with `extension` in the config) |
| `org.copeybara.status` | Safe or watcher | the watcher, or `copeybara incident` |
| `org.copeybara.blocklist` | Safe or watcher | the watcher, or `copeybara incident --block` |
| `url` | website key | your deploy pipeline |

Old `org.blackout.*` records stay readable, so kits saved before the rename keep working.

### Declarative exits (`org.copeybara.exits`)

For your own contracts you publish how to exit instead of writing adapter code. List the contract under adapter `spec` with exactly one function, and describe it in `exits`. `erc4626Kind('Your vault')` from `@copeybara/core` covers any ERC-4626 vault:

```json
{
  "label": "Your vault",
  "discover": { "mode": "balance", "amount": { "fn": "balanceOf(address)", "args": ["$account"] } },
  "tokens": [{ "fn": "asset()", "args": [] }],
  "exit": { "fn": "redeem(uint256,address,address)", "args": ["$amount", "$account", "$account"],
            "recipient": [1], "self": [2], "paysCaller": false, "returns": ["uint256"], "payout": [{ "token": 0, "ret": 0 }] }
}
```

- Discovery modes: `balance`, `enumerable` (ERC-721 style, capped at 50 ids) and `logs` (Transfer logs, each id confirmed with its owner).
- Placeholders: `$account`, `$amount`, `$id`, `$index`, `$deadline`, `$max`, `$min:i` (simulated output minus slippage) and literals. Every address argument must be `$account`.
- The Guard decodes a spec exit only with that kind's ABI and requires the calldata to re-encode byte for byte; banned selectors (approvals, permits, transfers) are rejected inside it as everywhere else ([`packages/guard/test/spec.test.ts`](../packages/guard/test/spec.test.ts), 10,000-run property tests).
- **Fail-closed.** A spec cannot express an approval, ETH, a signature or a second step, so such exits stay out of the kit. A position the contract refuses at simulation (paused, locked, short of liquidity) is shown as manual and nothing is sent.

Anything that does not fit: `pnpm copeybara adapter new <name>` scaffolds a code adapter with a fork test, Guard corpus cases and a property test.

### Site fingerprint plugins

`@copeybara/vite-plugin`, `@copeybara/next-plugin` and `@copeybara/webpack-plugin` hash every script the build ships, write `dist/.well-known/copeybara-site.json`, add a summary to the GitHub Actions job (with a diff against the live `org.copeybara.site` when `ens` is set) and fail the build on a third-party script without a matching SRI pin. Next.js App Router inline scripts cannot be fingerprinted from the client compiler; use `output: 'export'` and `copeybara fingerprint --dist out`.

### The widget

```html
<script src="/copeybara-exit.js"></script>
<copeybara-exit ens="yourprotocol.eth" kit="/copeybara-kit.html" sha256="<kit sha256>"
  extension="/copeybara-extension-chrome.zip" extension-sha256="<zip sha256>" certified></copeybara-exit>
```

One 6.6 kB file with no dependencies. It shows the download, your ENS name, the sha256 values, the verify commands and: "Verify this file against <name> before you use it. This website cannot vouch for itself." With `certified` it links to the live check on the Copeybara site; it never draws a tick itself. Its sha256 is published in [`copeybara-exit.js.sha256`](../packages/widget/copeybara-exit.js.sha256); include it in your site fingerprint like any other script.

### The watcher

`pnpm copeybara watcher` writes `.copeybara/watcher/compose.yml` and `watcher.env.example`; put the watcher key in `watcher.env` (gitignored) and run `pnpm copeybara watcher --up`. The container runs as a non-root user with a read-only filesystem, refuses to start with any key other than the configured watcher address, and its `/healthz` turns unhealthy after four missed check intervals ([`apps/watcher/Dockerfile`](../apps/watcher/Dockerfile)).

### Copeybara certified

`copeybara certify` runs `verify`, the certified rules and checks that the last drill used this exact kit. The rules are checked on chain: the Safe owns the name in the .eth registry, the release needs ≥2 signatures, every record reads cleanly, the website key writes `url` only, a watcher writes `status` and `blocklist` only, the site fingerprint is published and the status is not compromised. Listed protocols get a tick on the Copeybara website that is recomputed from ENS through three RPCs on every view; a protocol that loosens its keys loses it automatically. The tick cannot see who holds the Safe keys, and it is not an audit.

## Release runbook

1. Build the kit reproducibly: `SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build`. Bump `kit.version` in the config. Any kit change changes its sha256.
2. If the extension changed: `node apps/extension/scripts/build.mjs`, bump `extension.version`, set `extension.tree` to the printed tree hash.
3. `pnpm copeybara manifest --onchain`, `pnpm copeybara release`, and `pnpm copeybara fingerprint --dist dist` for a new site build.
4. `pnpm copeybara propose`. Check the printed calls, import the batch, collect signatures, execute.
5. Host the new kit next to the old one. `pnpm copeybara verify` must print `release MATCH`; `scripts/verify-kit.sh <kit> <name>` gives the same answer without the SDK.
6. `pnpm copeybara drill` and `pnpm copeybara certify` before telling users.

## Incident runbook

**Your website or DNS is hijacked.**
1. `pnpm copeybara incident --state compromised --note "Site hijacked. Use your saved exit kit."` and add look-alike hosts with `--block host`. Sign and execute the Safe batch. The watcher does this by itself after two fingerprint mismatches in a row, so the batch may only confirm it.
2. Extensions following your name block the site before it loads; the kit keeps working because it never reads status.
3. Point users to the kit and your ENS name through channels that do not depend on the site.
4. Fix DNS, redeploy, `copeybara fingerprint`, `copeybara propose` for the new `org.copeybara.site`, then `copeybara incident --state ok`. A compromised status set by the Safe stays until the Safe clears it.

**The website key leaks.** It can only change `url`. Revoke its role through the Safe, rotate the key, and propose the grant for the new one (`copeybara propose` after updating `websiteKey`).

**The watcher key leaks.** It can only raise or clear warnings. `contracts/script/watcher-role.sh revoke` (one Safe transaction), then rotate and re-grant.

**A Safe signer is lost or compromised.** Rotate the owner in the Safe. Nothing in Copeybara needs to change unless the threshold drops below 2, which suspends certification.

**The exit itself fails (contract paused or insolvent).** Copeybara cannot help: the kit shows the position as manual and sends nothing.

## Non-goals

- **No hosted backend, no analytics, no custody.** Everything runs from your repository, your Safe and public RPCs. The Copeybara website only re-reads ENS.
- **No protection against** smart-contract exploits, stolen user keys, or paused or insolvent contracts.
- **No signing.** The SDK proposes; your Safe signers decide.
- **No override.** The Exit Guard is fail-closed; nothing in the SDK can loosen it for a user.
