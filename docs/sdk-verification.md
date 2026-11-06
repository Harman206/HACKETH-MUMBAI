# SDK verification: onboarding a new protocol, end to end

Date: 2026-11-07. Goal: follow [protocol-integration.md](protocol-integration.md) literally as a new team, for a new protocol `samplevault.eth` (the [`SampleVault`](../contracts/src/SampleVault.sol) ERC-4626 vault), and check that the kit, the extension and the widget consume what it publishes.

Where it ran: an anvil fork of Sepolia, anvil default keys only, nothing sent to a live network. Safe owners were anvil accounts 0, 1 and 2 (2-of-3), the website key account 3, the user account 5, the watcher account 9. The protocol's directory was a temp folder outside the repo, as a team's own repo would be. Live Sepolia was only read (part 3).

The whole run is automated in [`packages/protocol-cli/test/onboarding.fork.test.ts`](../packages/protocol-cli/test/onboarding.fork.test.ts) (`pnpm test:fork`, about 2 minutes).

## 1. Onboarding, step by step

| Step (as documented) | Worked? | Evidence | Fix |
|---|---|---|---|
| Deploy SampleVault, user deposits 1000 sUSD (+50 yield) | yes | `forge create … SampleVault` → vault deployed; `balanceOf(user)` = 1e21, `previewRedeem(1e21)` = 1.05e21 | — |
| Name: `SetupName.s.sol` `commit()` / 60 s / `finish()` | yes, docs unclear | `samplevault.eth` owned by Safe `0xD872…cF74`, resolver `0x20eB…16eC`, `url` granted to the website key. The guide did not say which env vars the script needs or that a placeholder release and empty manifest are fine. | docs: env list + commands in the Quick start |
| `pnpm copeybara init` then `manifest` (config in the repo root, as documented) | **no** → fixed | `copeybara: Could not load copeybara.config.ts: Cannot find package '@copeybara/protocol-cli'`. In a folder without `"type": "module"`: `ERR_REQUIRE_CYCLE_MODULE`. | 88e3c53: module hooks resolve `@copeybara/*` to the CLI's copies and load the config as ESM. Test: `config-anywhere.test.ts` |
| `manifest --onchain` | yes | `org.copeybara.manifest → .copeybara/manifest.txt` `{"v":1,"c":{"11155111":{"spec":{"vault":{"a":"0xe5be…782C","s":["0xba087652"]}}}}}` and `org.copeybara.exits` | — |
| `manifest` refuses what the Guard can't check | yes | `withdraw(...) is not in the ABI`, `approve(address,uint256) moves or approves tokens; it can never be an exit function`, no ABI and no RPC → `give an abi path or run with an RPC (--onchain)` | — |
| Spec contract with no ABI file (bytecode proof) through `propose` / `verify` / `drill` | **no** → fixed | `manifest --onchain` passed, then `verify` and `propose` stopped: `give an abi path or run with an RPC (--onchain) so redeem(...) can be proven to exist` | 3fe0cee (see "Bytecode-only manifests" below) |
| `release` | yes | `sha256:301d3e86…b2b3;v=1` | — |
| Tiny Vite site with `@copeybara/vite-plugin` (`vite build` with a `vite.config.ts`) | **no** → fixed | `failed to load config … Cannot find module '…/packages/fingerprint/src/index' imported from …/fingerprint/src/build.ts`. Vite (and webpack, Next.js) load the config with plain Node, which can't run the TS sources. | a81a976: plugin entries are plain JS; fingerprint code loads via tsx. Tests: `real-build.test.ts`, `plain-node.test.ts` |
| Vite plugin after the fix | yes | `✓ 1 script hash(es)` … `Differs from the published org.copeybara.site: +1 / -0`; writes `dist/.well-known/copeybara-site.json` | — |
| webpack plugin, real `webpack` 5.96 build (scratch install) | yes (after a81a976) | clean build writes the record; an unpinned `<script src="https://cdn.example/x.js">` → `ERROR in copeybara: this build cannot be published`, exit 1 | — |
| Next.js plugin, real `next build` 15.1 (scratch install, App Router, `output: 'export'`) | yes (after a81a976) | `### Copeybara site fingerprint … ✓ 13 script hash(es)` (`.next/static`); `copeybara fingerprint --dist out` → 20 hashes incl. 7 inline. The plugin writes no `.well-known` file; the guide said it did. | docs |
| `fingerprint --dist site/dist` | yes | `org.copeybara.site → .copeybara/site.txt`, 3 hashes: app bundle, the widget (`eea1e244…`, same as `copeybara-exit.js.sha256`), the kit's inline script. Equals the plugin's record. | — |
| `propose` | yes | `skip website key → url: already granted` … `6 call(s), one batch` (release, manifest, exits, site, watcher → status, watcher → blocklist). `safeTxHash 0x383b…5eaa` equals the Safe's own `getTransactionHash`. | — |
| Apply the batch with the 2-of-3 Safe | yes | two owners signed the `safeTxHash` from `.copeybara/safe-tx.json`, `execTransaction` (DELEGATECALL to MultiSendCallOnly) → `ExecutionSuccess`. The guide didn't mention `safe-tx.json`. | docs |
| `propose` again | yes | `Nothing to propose: ENS already says what the config says.` | — |
| `verify` | yes | `✓ release MATCH v=1 301d3e86…`, `✓ manifest MATCH`, `✓ exits MATCH`, `✓ site MATCH 3 scripts`, `✓ website key … url only`, `✓ watcher key … status + blocklist only`, `✓ safe 2 of 3`, `✓ kit view`, `verify: OK` | — |
| `roles-check --live` and `roles-check` (fork) | yes | `roles-check: OK (35 calls)` both ways; forbidden writes `reverted`, the Safe control writes `allowed` | — |
| `drill` | **no** → fixed | `copeybara: samplevault.eth is not set up on ENS`. It forked public Sepolia whatever `rpcs` said, and first "wrote" the records to an address with no code there. The guide didn't mention the `drill` config entry either. | 41e34f4: forks `rpcs[chain][0]`, stops if the resolver has no code. Docs: `drill: { chainId, user?, seed }` |
| `drill` after the fix | yes | `kit found 1 position(s): Sample vault` · `exit Sample vault: recovered` · `drill: RECOVERED with the website and primary RPC off`; delta 0 → 1050 sUSD, min 1044.75 | — |
| `certify` | yes | all `✓` incl. `certify: owner`, `watcher`, `site fingerprint`, `drill … (site and primary RPC off)` → `certify: PASS` | — |
| `incident --state compromised --block …` | partly → fixed | Batch was right (2 calls: status + blocklist), but only a Transaction Builder file: no nonce, no `safeTxHash`, no `--api`, unlike `propose`. | 41e34f4: also writes `incident-tx.json`; `--nonce` / `--api` |
| Apply incident batch, then `verify` / `certify` | yes | `! status COMPROMISED: v=1;state=compromised;…`, `verify: OK` (a warning); `✗ certify: status compromised: certification suspended` | — |
| `incident --state ok` | yes | `✓ status v=1;state=ok;at=…;note=Resolved` | — |
| `watcher` | yes | `.copeybara/watcher/compose.yml` (WATCH_NAMES, WATCHER_ADDRESS, RPCS, CANDIDATES, `read_only: true`), `watcher.env.example`, `.gitignore` | — |
| Watcher with that env (run with `tsx`, no Docker here) | yes | `/healthz` → `last check 2 s ago`; official site `match`; after injecting `<script>window.drain=1</script>` → `raised: 1 unknown script(s)`, status `compromised` written by the watcher key; restoring the page cleared it | — |
| `watcher --up` (Docker) | not run | no Docker on this machine | — |
| Safe{Wallet} Transaction Builder import, `propose --api` | not run | no Safe UI or Transaction Service on a fork | — |

### Bytecode-only manifests

A contract listed with `functions` but no `abi` passes `manifest --onchain`, but `propose`, `verify`, `certify` and `drill` rebuilt the manifest without reading the chain and refused it. Fixed in 3fe0cee: they read the bytecode through the config's RPC (`propose --offline` still needs an ABI). The onboarding test runs `verify` and `propose` with a config that has no ABI.

## 2. The platform consumes it

| Check | Worked? | Evidence | Fix |
|---|---|---|---|
| Kit (built `copeybara-kit.html`, Playwright, injected test wallet) finds and exits the vault | yes | row `Sample vault — You would receive ≈ 1,050 sUSD` → `Recovered +1,050 sUSD back in your wallet`; wallet calls `eth_chainId, eth_estimateGas, eth_sendTransaction`, no signing | — |
| Kit flow (`apps/kit/src/flow.ts` + shipped adapters) in the fork test | yes | positions `['spec:vault']`, result `recovered`, user balance 1050 sUSD | — |
| Extension follows the name and calls the vault's exit `exit` | **no** → fixed | The extension gave `classifyRequest` the manifest only, so the Guard could not decode a `spec` contract: a redeem paying the user came out `unknown` (risky on the protocol's own site). | df8af73 (+ classify.ts in c0d53c1): the snapshot keeps `org.copeybara.exits` and passes it to the Guard. Tests: guard `classify.test.ts`, extension `core.test.ts`, and the fork test checks the kit's real redeem → `exit` |
| Extension reads status and blocklist of the new name | yes | records read through 3 RPCs: `blocklist ['samplevault-rewards.localhost']`, `status compromised` | — |
| Widget renders and links to the kit | yes | text: "…withdraw straight from samplevault.eth's contracts…", "Verify this file against samplevault.eth…"; links: `Download the exit kit → /copeybara-kit.html [download]`, `Copeybara certified — check it live ↗ → https://blackout-red.vercel.app/#/certified/samplevault.eth`; the only requests were the page, its bundle and `copeybara-exit.js` | — |

## 3. examples/demoswap against live Sepolia (read only)

`pnpm copeybara verify --config examples/demoswap/copeybara.config.ts`:

| Record | Before | After |
|---|---|---|
| resolver, owner (Safe owns the name) | MATCH | MATCH |
| release | **MISMATCH**: ENS v=8 `fc634a59…`, config v=6 with the v7 kit | MATCH v=8 (1cf2739: version 8, hosted v8 kit, which matches ENS) |
| manifest | MATCH | MATCH |
| exits | none (DemoSwap has no declarative exits) | same |
| site | 3 scripts published, not compared (no local build of the harness site) | same |
| website key / watcher key | url only / status + blocklist only | same |
| Safe | 2 of 3 | same |
| status | ok | ok |
| extension | not compared: the config has no `extension` entry (ENS has v5) | same |

`certify` on DemoSwap: every on-chain rule passes; it fails only on `✗ drill no drill report` (the config has no `drill` seed for its Uniswap positions). The example's version will go stale again at the next release.

## What still doesn't work or wasn't tested

- `watcher --up` was not run (no Docker). The Dockerfile runs `pnpm` at start as the `node` user on a read-only filesystem, and `apps/watcher` has no `tsx` dependency of its own. Both may fail at start; worth one real `docker compose up`.
- Safe{Wallet} import of `safe-batch.json` and `propose --api` were not tested.
- The Next.js plugin only sees `.next/static`; App Router pages need `output: 'export'` + `copeybara fingerprint --dist out`. Next 16 builds with Turbopack by default and would skip the webpack hook entirely (not tested).
- The widget's verify line shows `scripts/verify-kit.sh`, a path in this repo that users won't have.
- `pnpm test` has one failure outside the SDK (`apps/site` verify output) that went away once the example and the Developers page were updated for kit v8.
