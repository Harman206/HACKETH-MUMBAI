# Exit spec

`org.copeybara.exits` lets the kit exit **your own contracts** without anyone writing adapter code. You describe how to find a user's position and the one call that withdraws it. The kit's generic `spec` adapter runs that description, and the Exit Guard checks every call against it.

The record holds **no addresses**. Each entry (a *kind*) is named after a role under the manifest's `spec` adapter, and the manifest carries the address and the one allowed selector. Both records are written by your Safe.

## Example: ERC-4626 vault

`erc4626Kind('Your vault')` from `@copeybara/core` produces:

```json
{
  "label": "Your vault",
  "discover": { "mode": "balance", "amount": { "fn": "balanceOf(address)", "args": ["$account"] } },
  "tokens": [{ "fn": "asset()", "args": [] }],
  "exit": {
    "fn": "redeem(uint256,address,address)",
    "args": ["$amount", "$account", "$account"],
    "recipient": [1],
    "self": [2],
    "paysCaller": false,
    "returns": ["uint256"],
    "payout": [{ "token": 0, "ret": 0 }]
  }
}
```

In the config:

```ts
chains: { '1': { spec: { vault: { address: '0x…', functions: ['redeem(uint256,address,address)'], abi: 'out/Vault.sol/Vault.json' } } } },
exits: { vault: erc4626Kind('Your vault') },
```

`copeybara manifest` writes the record as `{"v":1,"kinds":{"vault":{…}}}`, one kind per `spec` role.

## ExitKind fields

| Field | Meaning |
|---|---|
| `label` | name shown to users |
| `discover` | how positions are found (below) |
| `tokens` | view calls on the target returning the payout token addresses, e.g. `asset()` |
| `exit.fn` | canonical signature of the one exit function |
| `exit.args` | one placeholder or literal per argument |
| `exit.recipient` | argument indexes that receive the payout; each must be an address set to `$account` |
| `exit.self` | other address arguments that must also be the account (e.g. ERC-4626 `owner`) |
| `exit.paysCaller` | `true` when the contract pays `msg.sender`; the Guard then pins `from` to the account |
| `exit.returns` | return types, used to read simulated payouts |
| `exit.payout` | which return value is paid in which token (`token` indexes `tokens`); recovery is proven by these balance changes |

Every address argument must appear in `recipient` or `self`. An exit must pay a recipient argument or the caller.

## Discovery modes

| Mode | Fields | Finds |
|---|---|---|
| `balance` | `amount` | one position when `amount($account)` > 0 (shares, LP tokens) |
| `enumerable` | `count`, `byIndex`, `amount?` | `count($account)` ids via `byIndex($account, $index)`; at most 50 |
| `logs` | `event`, `toTopic`, `idTopic`, `owner`, `amount?`, `maxBlocks` | ids from a Transfer-style event to the account (scan ≤ 200,000 blocks), each confirmed with `owner($id) == $account` |

## Placeholders

| Placeholder | Value | Allowed in |
|---|---|---|
| `$account` | the connected account | address arguments only |
| `$id` | the position id found by discovery | discovery calls, exit |
| `$index` | 0…count-1 | `byIndex` |
| `$amount` | the position's amount from discovery | exit |
| `$deadline` | now + 20 minutes | exit |
| `$max` | the maximum value of the argument's type | exit |
| `$min:i` | simulated return value `i` minus slippage (needs an unsigned return) | exit |
| `"123"` | a decimal literal | any integer argument |
| `"true"` / `"false"` | a literal | bool arguments |

Only `address`, `bool` and `(u)intN` arguments are supported. No bytes, strings, arrays or tuples.

## Fail-closed by construction

- **Not expressible:** approvals, permits, transfers (banned selectors are refused), ETH value, signatures, a second call, or any address other than the user. If your exit needs one of these, it stays out of the kit; build a code adapter instead (`pnpm copeybara adapter new <name>`).
- **Not ambiguous:** an unknown field, placeholder or type is an error, never a default. An exit selector that collides with one the kit already decodes is refused.
- **Checked twice:** the kit decodes every spec call only with that kind's ABI and requires the calldata to re-encode byte for byte, so trailing or dirty bytes are rejected.
- **Refused at simulation → manual:** if the contract reverts when the kit simulates the exit (paused, locked, short of liquidity), the position is shown as manual and nothing is sent.

The drill proves this with a sample vault: `pnpm copeybara drill --sample` recovers a position described only by this spec, with the site and primary RPC switched off, and shows a paused vault as manual.
