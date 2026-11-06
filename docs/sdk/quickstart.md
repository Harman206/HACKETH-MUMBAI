# Quick start

From an ENS name owned by your Safe to a certified exit in about an hour. Nothing in these steps signs anything: your Safe owners approve one batch at the end.

## Before you start

- An **ENSv2 name on Sepolia** owned by your **Safe** (2-of-3 or more), with a **PermissionedResolver**. `contracts/script/SetupName.s.sol` in the Copeybara repo sets one up (`commit()`, wait 60 s, `finish()`; the env it needs is listed in `docs/protocol-integration.md` in the Copeybara repo). A placeholder release and an empty manifest are fine there: `propose` replaces them.
- Two separate keys, given as **addresses only**: a **website key** (your deploy pipeline; it will be allowed to write `url`) and a **watcher key** (it will be allowed to write `status` and `blocklist`).
- **Node 22** and **pnpm 9**. The SDK packages are not on npm yet; you run them from the repository.

## 1. Get the CLI

```bash
git clone https://github.com/Harman206/HACKETH-MUMBAI copeybara && cd copeybara
corepack enable && pnpm install
pnpm copeybara init          # writes copeybara.config.ts
```

## 2. Describe your protocol

Fill in `copeybara.config.ts` ([Configuration](configuration.md)):

```ts
import { defineConfig } from '@copeybara/protocol-cli';
import { erc4626Kind } from '@copeybara/core';

export default defineConfig({
  name: 'yourprotocol.eth',
  safe: '0x…',
  resolver: '0x…',
  websiteKey: '0x…',
  watcher: { key: '0x…', candidates: ['https://yourprotocol-claim.xyz'] },
  kit: { file: 'copeybara-kit.html', version: 1 },
  site: { url: 'https://app.yourprotocol.xyz', dist: 'dist' },
  chains: {
    '1': {
      spec: { vault: { address: '0x…', functions: ['redeem(uint256,address,address)'], abi: 'out/Vault.sol/Vault.json' } },
    },
  },
  exits: { vault: erc4626Kind('Your vault') },
});
```

Get the kit with `SOURCE_DATE_EPOCH=0 pnpm --filter @copeybara/kit build` (it lands in `apps/kit/dist/copeybara-kit.html`) and point `kit.file` at it.

## 3. Build the records

```bash
pnpm copeybara manifest --onchain        # org.copeybara.manifest + org.copeybara.exits
pnpm copeybara release                   # org.copeybara.release (+ org.copeybara.extension)
pnpm copeybara fingerprint --dist dist   # org.copeybara.site
```

Each command refuses what the Exit Guard could not check: a function missing from your ABI or bytecode, a banned selector such as `approve`, an exit that would need ETH or a signature, or a third-party script without an SRI pin.

## 4. Propose one Safe batch

```bash
pnpm copeybara propose
```

This writes `.copeybara/safe-batch.json`: every record that differs from ENS, plus the scoped grants that are still missing. `.copeybara/safe-tx.json` has the same calls as one Safe transaction, with the `safeTxHash` your owners sign. In Safe{Wallet}, open **Apps → Transaction Builder**, drag the file in, create the batch, and have your owners sign on their own devices. See [Safe proposals](safe-proposals.md).

## 5. Prove it

```bash
pnpm copeybara verify              # read everything back through 3 RPCs
pnpm copeybara roles-check --live  # forbidden writes revert; the same writes as the Safe succeed
pnpm copeybara drill               # fork, switch off site + primary RPC, exit a seeded position
```

`verify` against the live demo looks like this (abridged):

```text
demoswap-blackout.eth at Sepolia block 12079624 (3 RPCs, ≥2 agreeing):
✓ resolver     0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82
✓ owner        the Safe owns demoswap-blackout.eth
✓ release      MATCH v=8 fc634a590f3290f42bad8694877a6c6d806bfbc6b71b6a9b78f5917f6b778cc9
✓ manifest     MATCH
✓ website key  0xA2f199fEd2Fecf201422C71e1E53C76Fd6f4d182 may write url only
✓ watcher key  0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8 may write status + blocklist only
✓ safe         2 of 3 signers
✓ kit view     the kit reads every record without a problem

verify: OK
```

## 6. Ship it to users

- Add a build plugin so every deploy is fingerprinted: [Site fingerprint](site-fingerprint.md).
- Put `<copeybara-exit>` on your site: [Widget](widget.md).
- Start the watcher: `pnpm copeybara watcher --up` ([Watcher](watcher.md)).

## 7. Get certified

```bash
pnpm copeybara certify   # → .copeybara/certification.json
```

Send us the report. Once listed, your protocol gets the Copeybara certified tick: [Certification](certification.md).
