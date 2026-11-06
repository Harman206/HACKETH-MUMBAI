# Certification

Protocols we onboard get the **Copeybara certified** tick. The Copeybara website does not hand it out as a static badge. Every time someone opens your page there (`#/certified/<your name>`), it reads your ENS name through three independent RPCs and re-runs the checks. If you loosen your keys or stop publishing, you lose the tick automatically.

## The rules

Checked on chain, on every view:

1. Your Safe owns the ENS name (ENSv2 .eth registry).
2. The name resolves through your registered resolver.
3. Changing the release needs at least 2 Safe signatures.
4. A kit release and an exit manifest are published, and every Copeybara record reads cleanly.
5. The website key can write `url` and nothing else.
6. A watcher has write access to `status` and `blocklist` only.
7. Your site's script fingerprint is published.
8. The status record does not say `compromised`.

Checked once, before listing:

9. `copeybara certify` passes, including a drill that exited a real position with your website and primary RPC switched off, using the same kit you published.

## How to get certified

```bash
pnpm copeybara drill
pnpm copeybara certify      # → .copeybara/certification.json; exit 1 on any ✗
```

1. Fix every ✗ line and run again until it prints `certify: PASS`.
2. Send us `certification.json`. It holds your name, the block, the kit sha256 and every check.
3. We review it and add your entry to `config/certified.json` in the public repository: protocol name, ENS name, Safe, resolver, website key, watcher and date.
4. Your page at `https://blackout-red.vercel.app/#/certified/<your name>` shows the tick from then on, while the live checks pass.

## Showing it on your site

```html
<copeybara-exit ens="yourprotocol.eth" certified></copeybara-exit>
```

The widget links to your live check; it never draws a tick itself. Tell users to reach the check by typing the Copeybara address rather than trusting a badge on any page, including yours.

## What it does not mean

- It is **not a smart-contract audit**. It says nothing about exploits, solvency or paused contracts.
- It cannot see **who holds the Safe keys**: three keys on one laptop pass the 2-of-3 rule. The demo protocol is marked that way.
- A suspended tick means a rule fails right now. The page shows which one.
