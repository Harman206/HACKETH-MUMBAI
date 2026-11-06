# Drill

The drill proves your exit works when it matters: with your website and your primary RPC switched off. It runs headlessly on local anvil forks: it reads from your RPCs to fork, and never sends anything to a live network.

```bash
pnpm copeybara drill            # your protocol, from the config
pnpm copeybara drill --sample   # a sample ERC-4626 vault described only by an exit spec (no config needed)
```

## What it does

1. Forks the ENS chain and your exit chain (1 or 11155111) with anvil, from the first URL in your `rpcs[chainId]` (or the public defaults). Point `rpcs` at a node that has your name and contracts, for example your own fork during a rehearsal.
2. Runs your `drill.seed` to give the drill user a real position.
3. Writes your manifest, exit spec and a `url` on the fork as your Safe (impersonated: no key is used).
4. Puts three RPC proxies in front of the fork, then **switches off your website and the primary RPC**.
5. Does what the kit does: reads ENS through the quorum, discovers positions, builds each exit, runs the Exit Guard, simulates, sends, waits for the receipt and checks every token's balance went up by at least the minimum.
6. Writes `.copeybara/drill.json`. It passes only if the website and primary RPC were really off, at least one position was exited, every exit was recovered, and every extra check passed. Otherwise exit code 1.

```text
  website OFF · primary RPC OFF
  kit found 1 position(s): Sample vault
  exit Sample vault: recovered
  ✓ a paused vault is manual, never sent: …
drill: RECOVERED with the website and primary RPC off
```

## Seeding your protocol

```ts
drill: {
  chainId: 1, // fork for the exit contracts; default: the first chain in `chains`
  seed: async ({ fork, user }) => {
    // fork.testClient (anvil cheats), fork.publicClient, fork.wallet(address) for impersonated sends
    const whale = '0x…';
    await fork.testClient.impersonateAccount({ address: whale });
    await fork.wallet(whale).writeContract({ address: VAULT, abi, functionName: 'deposit', args: [10n ** 21n, user] });
  },
},
```

The seed runs only against the local fork. Use impersonation for any account you need; never a real key. If `drill.user` already holds a position on the forked chain, `seed: async () => {}` is enough.

## Requirements

- Foundry's `anvil` on your `PATH`.
- RPCs that can serve a fork of the chain (the defaults usually work; set `rpcs` if they rate-limit).
- About 100 seconds.

`copeybara certify` requires a passing `drill.json` made with the same kit sha256 you are certifying.
