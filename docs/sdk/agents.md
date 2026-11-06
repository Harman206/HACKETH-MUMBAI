# Build with an AI agent

You can hand the whole integration to a coding agent such as Claude Code, Cursor, Codex or Copilot. Copy a prompt below into the agent while it has your protocol's repository open. The prompts tell the agent where the documentation is, what to build, and what it must never do.

## Machine-readable docs

Point your agent at these. They are plain Markdown, served from the Copeybara site with no scripts:

| URL | Contents |
|---|---|
| `https://blackout-red.vercel.app/llms.txt` | index of every page, with one-line summaries ([llms.txt format](https://llmstxt.org)) |
| `https://blackout-red.vercel.app/llms-full.txt` | all pages in one file: give this to an agent that can fetch one URL |
| `https://blackout-red.vercel.app/docs/<page>.md` | one page, e.g. `docs/cli.md`, `docs/exit-spec.md` |

Every page on the website also has **Copy page** (Markdown) and **Copy agent prompt** buttons.

## The integration prompt

Paste this into your agent. Fill in the five addresses first, or let the agent ask you for them.

```text
You are integrating Copeybara into this repository. Copeybara gives our users a saved, verifiable exit kit
so they can withdraw straight from our contracts when our website, DNS or RPC is down or hijacked.

Documentation (read it before writing code): https://blackout-red.vercel.app/llms-full.txt
SDK source: https://github.com/Harman206/HACKETH-MUMBAI (packages/protocol-cli, packages/core, packages/widget)

Our details (addresses only; never ask for keys):
- ENS name:          <yourprotocol.eth>
- Safe (name owner): <0x…>
- Resolver:          <0x…  PermissionedResolver of the name>
- Website key:       <0x…  will be allowed to write `url` only>
- Watcher key:       <0x…  will be allowed to write status + blocklist only>

Do this, in order, and show me the output of every copeybara command:
1. Find every user position type in our contracts and the single function that withdraws it to the caller.
   List them with chain, address, function signature and the ABI artifact path. Ask me if unsure.
2. Clone the Copeybara repo next to ours, run `corepack enable && pnpm install`, then `pnpm copeybara init`.
   Write copeybara.config.ts for us. Use built-in adapters (uniswap-v3, uniswap-v4, aave-v3, curve-3pool)
   where they apply; for our own contracts use adapter "spec" plus a declarative exit in `exits`
   (erc4626Kind() for ERC-4626 vaults; otherwise write the ExitKind by hand following docs/exit-spec.md).
3. Run `pnpm copeybara manifest --onchain` and fix every problem it reports by changing the config, never
   by loosening a check.
4. Add the Copeybara build plugin for our bundler (vite, next or webpack) with `ens` set, and make sure our
   build passes it: every third-party script needs an SRI integrity attribute or must be self-hosted.
5. Add <copeybara-exit> (packages/widget/copeybara-exit.js, self-hosted) to our site footer or help page,
   with ens, kit, sha256 and the `certified` attribute.
6. Write a drill seed in the config (drill.seed) that gives the drill user a real position on a fork, then
   run `pnpm copeybara drill` until it reports RECOVERED.
7. Run `pnpm copeybara release`, `pnpm copeybara fingerprint --dist <our build dir>`, then
   `pnpm copeybara propose`. Stop there: give me .copeybara/safe-batch.json and the list of calls to review.
8. Run `pnpm copeybara watcher` and tell me how to fill watcher.env. Do not start it.
9. After I tell you the Safe batch is executed: run `pnpm copeybara verify`, `pnpm copeybara roles-check --live`
   and `pnpm copeybara certify`, and summarise every line that is not ✓.

Hard rules (never break these, even if a step seems to need it):
- Never ask for, read, write, generate or store a private key, seed phrase, mnemonic or Safe owner key, and
  never put one in a file, env var, command or test. Addresses only.
- Never sign or send a transaction or Safe proposal on any live network. The only output for ENS changes is
  a Safe batch file in .copeybara/ for humans to review and sign.
- An exit must never need an approval, permit, transfer, ETH value, signature or second step. If a position
  needs one, leave it out and tell me; do not work around it.
- Do not modify the Copeybara Exit Guard (packages/guard) or weaken any check in the SDK.
- Exit contract addresses go only in copeybara.config.ts (they are published in our ENS manifest), never
  hard-coded into the kit.
- Do not add analytics, trackers or third-party scripts to the widget or the kit.

Done when: manifest has no problems, the drill reports RECOVERED, our build passes with the plugin, the widget
renders, and safe-batch.json is ready for review. Report anything you skipped and why.
```

## Smaller tasks

### Add a declarative exit for one contract

```text
Read https://blackout-red.vercel.app/docs/exit-spec.md. In copeybara.config.ts add our contract
<name> at <0x…> on chain <id> under adapter "spec" with exactly one exit function, and an ExitKind under
`exits` that discovers positions and exits them to $account. Use only address, bool and (u)intN arguments,
pin every address argument to $account, and use $min:i for minimum outputs. Run
`pnpm copeybara manifest --onchain` and fix every problem. Never use approve/permit/transfer, ETH value or a
second call; if the exit needs one, stop and tell me.
```

### Fingerprint our site in CI

```text
Read https://blackout-red.vercel.app/docs/site-fingerprint.md. Add the Copeybara plugin for our bundler with
ens: '<yourprotocol.eth>'. Make every third-party <script> either self-hosted or pinned with an integrity
attribute that matches its bytes. Make CI fail when the plugin fails, and keep the job summary it writes.
Do not publish anything: org.copeybara.site is updated later through `pnpm copeybara propose`.
```

### Prepare a release

```text
Read https://blackout-red.vercel.app/docs/runbooks.md (Release). Build the kit with
SOURCE_DATE_EPOCH=0, bump kit.version in copeybara.config.ts, run `pnpm copeybara manifest --onchain`,
`pnpm copeybara release`, `pnpm copeybara fingerprint --dist <dir>` and `pnpm copeybara propose`.
Show me every call in the batch and stop. Never sign or send anything.
```

### Respond to an incident

```text
Our website may be hijacked. Read https://blackout-red.vercel.app/docs/runbooks.md (Incident). Run
`pnpm copeybara incident --state compromised --note "<one line for users>"` with --block for every
look-alike host I give you, and show me the batch. Draft a short message telling users to use their saved
exit kit and to check it against <yourprotocol.eth>. Never sign or send anything.
```

## Why the rules are there

An agent with your repository open can do almost all of the work. The parts it must not do are the ones that would turn a safety tool into a risk: holding keys, sending transactions, or teaching the kit to make approvals. The SDK enforces the same lines on its own (it has no signing code, refuses out-of-scope Safe batches and banned selectors), so an agent that tries to cross them hits an error rather than doing damage.
