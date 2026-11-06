# Configuration

Every command reads `copeybara.config.ts` from the current directory (or `--config <file>`; `.json` works too). Relative paths inside it resolve against the config file's directory. `defineConfig` only adds type checking.

```ts
import { defineConfig } from '@copeybara/protocol-cli';
export default defineConfig({ /* … */ });
```

## Fields

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | your ENS name, ending in `.eth` |
| `safe` | yes | the Safe that owns the name; every record write is proposed to it |
| `resolver` | yes | the name's PermissionedResolver |
| `websiteKey` | yes | your deploy key's address; it gets write access to `url` only. Must not be the Safe |
| `watcher` | for certification | `{ key, candidates?, intervalMs? }`: the watcher's address (not the Safe or website key), look-alike URLs it should probe, check interval (default 15000 ms) |
| `kit` | yes | `{ file, version }`: the exit kit HTML and its release version (≥ 1) |
| `extension` | no | `{ file, version, tree? }`: the extension zip, its version and its tree hash |
| `site` | no | `{ url, dist? }`: your official site and its build folder |
| `chains` | yes | exit contracts: `chains[chainId][adapter][role] = { address, functions?, abi? }` |
| `exits` | no | declarative exits: `exits[role] = ExitKind` for every `spec` role ([Exit spec](exit-spec.md)) |
| `ensChainId` | no | chain of the ENS name; default 11155111 (Sepolia, ENSv2) |
| `universalResolver`, `ethRegistry` | no | ENSv2 contracts; default from the kit's `config/networks.json` |
| `rpcs` | no | `rpcs[chainId] = [url, url, url]`: three independent providers per chain. Defaults exist for chains 1 and 11155111 |
| `safeTxService` | for `propose --api` | Safe Transaction Service base URL |
| `out` | no | output folder; default `.copeybara` |
| `drill` | for `drill` | `{ chainId?, user?, seed }` ([Drill](drill.md)) |

## Exit contracts

`chains` lists every contract the kit may call or read, per chain, per adapter, per role:

```ts
chains: {
  '1': {
    'uniswap-v3': {
      positionManager: {
        address: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
        functions: ['multicall(bytes[])', 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))', 'collect((uint256,address,uint128,uint128))'],
      },
    },
    'uniswap-v4': { stateView: { address: '0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227' } }, // read-only: no functions
    spec: { vault: { address: '0x…', functions: ['redeem(uint256,address,address)'], abi: 'out/Vault.sol/Vault.json' } },
  },
},
```

- **Adapters:** `uniswap-v3`, `uniswap-v4`, `aave-v3`, `curve-3pool` (built in, with fixed roles and functions), and `spec` for your own contracts.
- **`functions`** are canonical signatures (no spaces, no names; tuples in parentheses). Empty or absent means read-only.
- **`abi`** is a JSON ABI or a Foundry/Hardhat artifact. `manifest` checks every function exists in it. With `--onchain` it also checks the deployed bytecode contains each selector.
- A `spec` role allows **exactly one** function, and it must be the exit of `exits[role]`.

## What `manifest` refuses

- a function that is not canonical, not in the ABI, or not in the bytecode (`--onchain`);
- `approve`, `increaseAllowance`, permits, `setApprovalForAll`, `transfer`, `transferFrom`, `safeTransferFrom` and Permit2 functions, anywhere;
- a role a built-in adapter does not have, or functions outside its allowlist;
- a `spec` role without a matching `exits` entry, or with more than one function.

## A complete example

`examples/demoswap/copeybara.config.ts` in the repository describes the live Sepolia demo. A test checks that it rebuilds the published manifest byte for byte.
