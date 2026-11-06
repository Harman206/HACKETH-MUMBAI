/** Copy for the developer (SDK) page. Every command and output here is real; see packages/protocol-cli and examples/demoswap. */

export const REPO_URL = 'https://github.com/Harman206/HACKETH-MUMBAI';

export const DEV_HERO = {
  title: 'Ship an exit that outlives your website.',
  sub: 'The Copeybara SDK publishes your exit kit, exit contracts and site fingerprint to your ENS name, turns every change into one Safe batch, and proves on a fork that users can still withdraw with your site and RPC switched off.',
};

export const DEV_FACTS = [
  { n: '0', unit: 'keys held', body: 'The CLI never asks for or holds a Safe owner key. Every record write is a Safe proposal your signers approve on their own devices.' },
  { n: '1', unit: 'Safe batch', body: 'Every changed record plus the scoped website and watcher grants, in one Transaction Builder file. Unchanged records are skipped.' },
  { n: '3', unit: 'RPCs agree', body: 'verify, certify and the kit read ENS through three providers at one pinned block. Two must answer and all answers must match.' },
  { n: '~100', unit: 'second drill', body: 'A fork drill seeds a position, switches off your website and primary RPC, exits headlessly and checks the balance change.' },
];

export const CAPABILITIES = [
  { pkg: '@copeybara/protocol-cli', title: 'One CLI for the whole release', body: 'Build the manifest from your ABIs, hash the kit and extension, propose the Safe batch, read everything back, prove key scopes and run the drill.' },
  { pkg: 'org.copeybara.exits', title: 'Declarative exits, no adapter code', body: 'Describe how a position is found and exited (balance, enumerable NFTs or logs; one exit call). The kit’s generic adapter runs it and the Exit Guard decodes it with the ABI you published.' },
  { pkg: '@copeybara/vite-plugin · next-plugin · webpack-plugin', title: 'Site fingerprint in your build', body: 'Hashes every script your build ships, writes .well-known/copeybara-site.json, diffs it against ENS in the CI summary and fails on unpinned third-party scripts. Plugins never publish.' },
  { pkg: '@copeybara/widget', title: '<copeybara-exit>, 6.6 kB', body: 'One dependency-free file that tells users where the verified kit is and how to check it. No fetches, no wallet calls, no cookies.' },
  { pkg: 'apps/watcher', title: 'Watcher in one command', body: 'copeybara watcher --up generates a hardened Docker Compose service with a healthcheck. Its key can write status and blocklist only.' },
  { pkg: 'copeybara certify', title: 'Copeybara certified', body: 'verify, the certified rules and a passing drill, in one report. Certified protocols get a tick that this site re-checks live from ENS.' },
];

export interface Step { title: string; body: string; code?: string }
export const QUICKSTART: Step[] = [
  {
    title: 'Get the CLI',
    body: 'The packages are not on npm yet; run them from the repository. Node 22 and pnpm 9.',
    code: `git clone ${REPO_URL} copeybara && cd copeybara\ncorepack enable && pnpm install\npnpm copeybara init          # writes copeybara.config.ts`,
  },
  {
    title: 'Describe your protocol',
    body: 'Your ENS name, the Safe that owns it, the two scoped keys and your exit contracts. Built-in adapters cover Uniswap v3/v4, Aave v3 and Curve 3pool; anything ERC-4626-shaped needs only a declarative exit.',
  },
  {
    title: 'Build the records',
    body: 'Each command refuses what the Exit Guard could not check: a function missing from the ABI or bytecode, a banned selector like approve, or an exit that needs ETH or a signature.',
    code: 'pnpm copeybara manifest --onchain   # org.copeybara.manifest + org.copeybara.exits\npnpm copeybara release              # kit (+ extension) sha256 → org.copeybara.release\npnpm copeybara fingerprint --dist dist   # org.copeybara.site; fails on unpinned third-party scripts',
  },
  {
    title: 'Propose one Safe batch',
    body: 'Open Safe{Wallet} → Transaction Builder → drag in .copeybara/safe-batch.json. Or post it to the Safe Transaction Service with a signature made elsewhere. The batch can only touch Copeybara records and the two scoped grants; anything else is refused before the file is written.',
    code: 'pnpm copeybara propose                       # → .copeybara/safe-batch.json + safe-tx.json (safeTxHash)\npnpm copeybara propose --api --sender 0x… --signature 0x…',
  },
  {
    title: 'Prove it',
    body: 'verify reads every record back through three RPCs. roles-check sends each forbidden write as the website and watcher keys (it must revert) next to the same write as the Safe (it must succeed). The drill exits a real position on a fork with your site and primary RPC off.',
    code: 'pnpm copeybara verify\npnpm copeybara roles-check --live\npnpm copeybara drill',
  },
  {
    title: 'Ship it to users',
    body: 'Add the build plugin, put the widget on your site, and start the watcher.',
    code: 'pnpm copeybara watcher --up    # docker compose, healthcheck, key from a gitignored watcher.env',
  },
  {
    title: 'Get certified',
    body: 'certify runs verify, the certified rules and checks the last drill used this exact kit. Send us the report to be listed.',
    code: 'pnpm copeybara certify        # → .copeybara/certification.json',
  },
];

export const CONFIG_SAMPLE = `import { defineConfig } from '@copeybara/protocol-cli';
import { erc4626Kind } from '@copeybara/core';

export default defineConfig({
  name: 'yourprotocol.eth',
  safe: '0x…',        // owns the name; every write is proposed to it
  resolver: '0x…',    // the name's PermissionedResolver
  websiteKey: '0x…',  // may write \`url\` only
  watcher: { key: '0x…', candidates: ['https://yourprotocol-claim.xyz'] }, // status + blocklist only

  kit: { file: 'copeybara-kit.html', version: 1 },
  site: { url: 'https://app.yourprotocol.xyz', dist: 'dist' },

  chains: {
    '1': {
      'uniswap-v3': { positionManager: { address: '0xC364…FE88', functions: ['multicall(bytes[])', /* … */] } },
      spec: { vault: { address: '0x…', functions: ['redeem(uint256,address,address)'], abi: 'out/Vault.sol/Vault.json' } },
    },
  },
  exits: { vault: erc4626Kind('Your vault') },
});`;

export const SPEC_SAMPLE = `{
  "label": "Your vault",
  "discover": { "mode": "balance", "amount": { "fn": "balanceOf(address)", "args": ["$account"] } },
  "tokens":   [{ "fn": "asset()", "args": [] }],
  "exit": {
    "fn": "redeem(uint256,address,address)",
    "args": ["$amount", "$account", "$account"],
    "recipient": [1], "self": [2], "paysCaller": false,
    "returns": ["uint256"], "payout": [{ "token": 0, "ret": 0 }]
  }
}`;

export const SPEC_RULES = [
  'Exactly one exit function per contract, and it must be the only selector the manifest allows there. The Guard decodes it with that ABI and requires the calldata to re-encode byte for byte.',
  'Placeholders: $account, $amount, $id, $index, $deadline, $max and $min:i (simulated output minus slippage). Every address argument must be $account: an exit never names another address.',
  'Positions are found by balance, by enumerable NFT (capped at 50) or by Transfer logs with the owner confirmed.',
  'A spec cannot express an approval, ETH, a signature or a second step, so those exits stay out of the kit. A position the contract refuses at simulation (paused, locked, short of liquidity) is shown as “manual” and nothing is sent.',
];

export const CLI = [
  ['init', 'Writes a copeybara.config.ts to fill in.', '—'],
  ['manifest [--onchain]', 'Builds org.copeybara.manifest and org.copeybara.exits from your ABIs (or bytecode).', 'manifest.txt, exits.txt'],
  ['release', 'Checks the kit is one self-contained file with a pinned CSP, then hashes it (and the extension zip).', 'release.txt, extension.txt'],
  ['fingerprint --dist d | --url u', 'Hashes every script the site runs. Fails on a third-party script without a matching SRI pin.', 'site.txt'],
  ['propose', 'One Safe batch for every changed record and scoped grant. --api posts it with an external signature.', 'safe-batch.json, safe-tx.json'],
  ['verify', 'Reads everything back through 3 RPCs: owner, release, manifest, exits, site, key scopes, Safe threshold, status, and the kit’s own reading.', 'exit 1 on any ✗'],
  ['roles-check [--live]', 'Sends each forbidden write as the website and watcher keys next to a Safe control, on a fork or as live eth_calls.', 'exit 1 on any ✗'],
  ['drill [--sample]', 'Fork, seed, switch off the site and primary RPC, discover → build → Guard → send → balance check.', 'drill.json'],
  ['certify', 'verify + the certified rules + a drill that used this exact kit.', 'certification.json'],
  ['incident --state s [--block host]', 'One Safe batch setting org.copeybara.status and the look-alike blocklist. Extensions block the site; exits are never affected.', 'incident-batch.json'],
  ['watcher [--up]', 'Docker Compose for the watcher from the config, with healthcheck and a pinned watcher address.', 'watcher/compose.yml'],
  ['adapter new <name>', 'Scaffolds a code adapter with a fork test, Guard corpus cases and a property test.', 'packages/adapters/…'],
] as const;

/** Captured from `pnpm copeybara verify` in examples/demoswap against Sepolia, 7 Nov 2026. */
export const VERIFY_OUTPUT = `$ pnpm copeybara verify
demoswap-blackout.eth at Sepolia block 12079041 (3 RPCs, ≥2 agreeing):
✓ resolver     0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82
✓ owner        the Safe owns demoswap-blackout.eth
✓ release      MATCH v=6 d0ff737b1b2d67bc1888da9e65d974c526d16aecf04708d2c80229adc04c3a4a
✓ manifest     MATCH
✓ exits        none (no declarative exits)
✓ site         3 scripts published (run copeybara fingerprint to compare with a build)
✓ website key  0xA2f199fEd2Fecf201422C71e1E53C76Fd6f4d182 may write url only
✓ watcher key  0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8 may write status + blocklist only
✓ safe         2 of 3 signers
✓ status       v=1;state=ok;at=1793995840
✓ kit view     the kit reads every record without a problem

verify: OK`;

export const PLUGINS = [
  { name: 'Vite', code: `// vite.config.ts\nimport { copeybara } from '@copeybara/vite-plugin';\nexport default defineConfig({ plugins: [copeybara({ ens: 'yourprotocol.eth' })] });` },
  { name: 'Next.js', code: `// next.config.mjs (client production build; for App Router inline scripts use output: 'export'\n// and copeybara fingerprint --dist out)\nimport { withCopeybara } from '@copeybara/next-plugin';\nexport default withCopeybara({ /* your config */ }, { ens: 'yourprotocol.eth' });` },
  { name: 'webpack', code: `// webpack.config.js\nimport { CopeybaraWebpackPlugin } from '@copeybara/webpack-plugin';\nexport default { plugins: [new CopeybaraWebpackPlugin({ ens: 'yourprotocol.eth' })] };` },
];

export const CI_SUMMARY = `### Copeybara site fingerprint · yourprotocol.eth

✓ 4 script hash(es)

Third-party scripts:
- pinned https://cdn.example/analytics.js

Differs from the published org.copeybara.site: +1 / -1. Run \`copeybara propose\` after deploying; the Safe signs the new record.
- + 9f2c…e41a assets/index-Bx3k.js
- - 1d07…a9b3`;

export const WIDGET_EMBED = `<script src="/copeybara-exit.js"></script>
<copeybara-exit
  ens="yourprotocol.eth"
  kit="/copeybara-kit.html" sha256="<kit sha256 from your release record>"
  extension="/copeybara-extension-chrome.zip" extension-sha256="<zip sha256>"
  certified></copeybara-exit>`;

export const GUARANTEES = [
  { title: 'No keys in the SDK', body: 'A test scans every SDK package for private-key and signing APIs. The only signer is your Safe.', where: 'packages/protocol-cli/test/no-keys.test.ts' },
  { title: 'The batch can’t escalate', body: 'Before a batch is written, every call is checked: Copeybara setText calls and the two scoped grants only. No root roles, no upgrades.', where: 'packages/protocol-cli/src/propose.ts' },
  { title: 'The Guard stays fail-closed', body: 'Spec exits are decoded with the published ABI and must re-encode exactly. The banned corpus plus spec cases run under 10,000-run property tests.', where: 'packages/guard/test/spec.test.ts' },
  { title: 'Status can’t block an exit', body: 'The watcher’s status and blocklist only warn about or block websites. The kit ignores both when building exits.', where: 'README → ENS records' },
  { title: 'The widget does nothing risky', body: 'A Playwright test under a strict CSP checks it makes 0 third-party requests, 0 wallet calls and sets no cookies or storage.', where: 'packages/widget/e2e/widget.spec.ts' },
];

export const NON_GOALS = [
  'No hosted backend, no analytics, no custody: everything runs from your repo, your Safe and public RPCs.',
  'No protection against smart-contract exploits, stolen user keys, or paused or insolvent contracts.',
  'No signing: the SDK proposes; your Safe signers decide.',
];
