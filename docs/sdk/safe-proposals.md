# Safe proposals

Every change to your ENS records goes through your Safe. The CLI builds the proposal; your owners review and sign it on their own devices. Nothing in the SDK can sign.

## `copeybara propose`

```bash
pnpm copeybara propose
```

1. Builds what the records should say: the manifest and exit spec from the config, the release from the kit (and extension), and the site record from `.copeybara/site.txt` (written by `copeybara fingerprint`) or `--site <record>`.
2. Reads ENS through the 3-RPC quorum and skips every record that already says the same thing.
3. Adds the scoped grants that are missing: the website key may write `url`; the watcher may write `status` and `blocklist`.
4. Checks the whole batch (below) and writes:
   - `.copeybara/safe-batch.json`: a Transaction Builder file;
   - `.copeybara/safe-tx.json`: the same calls as one MultiSendCallOnly transaction with its `safeTxHash`, when the Safe nonce is known.

```text
  skip  org.copeybara.manifest: already published

Safe 0x3ae0…057F on chain 11155111 — 2 call(s), one batch:
  1. setText org.copeybara.release = sha256:…;v=7
  2. setText org.copeybara.site = v=2;sha256=…

Transaction Builder file → .copeybara/safe-batch.json
```

| Flag | Effect |
|---|---|
| `--offline` | don't read ENS: propose every record and grant (no Safe nonce, so no `safe-tx.json` unless `--nonce`) |
| `--no-grants` | records only |
| `--nonce n` | Safe nonce for `safe-tx.json` |
| `--site <record>` | use this `org.copeybara.site` value |
| `--api --sender 0x… --signature 0x…` | post the transaction to `safeTxService`, using a signature of the `safeTxHash` that the owner made elsewhere |

## Signing it

**Transaction Builder (recommended):** Safe{Wallet} → Apps → Transaction Builder → drag in `safe-batch.json` → Create batch → Send. Each owner checks the calls and signs.

**Safe Transaction Service:** an owner signs the printed `safeTxHash` on their own device (hardware wallet, Safe app), then:

```bash
pnpm copeybara propose --api --sender 0xOwner --signature 0xSignature
```

The other owners see it in their queue.

## What a batch can contain

Before writing a file, `assertBatchScope` decodes every call and throws on anything else:

- `setText(name, key, value)` on **your** resolver and **your** name, for `org.copeybara.release`, `.manifest`, `.exits`, `.site` or `.extension` only;
- `grantSetterRoles(setText(name, key, ""), account)` for exactly: website key → `url`; watcher → `org.copeybara.status`, `org.copeybara.blocklist`.

Root roles, resolver upgrades, other names and other keys are refused. The incident batch (`copeybara incident`) has its own, narrower scope: `status` and `blocklist`, and no grants ([Runbooks](runbooks.md)).

## Checking it landed

```bash
pnpm copeybara verify
pnpm copeybara roles-check --live
```

`roles-check` sends each forbidden write (website key → release, watcher → manifest, self-grants, resolver upgrade…) as an `eth_call` and expects a revert, next to the same write from the Safe, which must succeed. A check that passes only because everything reverts is caught by those Safe controls.
