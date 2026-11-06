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

/** Captured from `pnpm copeybara verify` in examples/demoswap (kit v7) against Sepolia, 7 Nov 2026. */
export const VERIFY_OUTPUT = `$ pnpm copeybara verify
demoswap-blackout.eth at Sepolia block 12079453 (3 RPCs, ≥2 agreeing):
✓ resolver     0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82
✓ owner        the Safe owns demoswap-blackout.eth
✓ release      MATCH v=7 301d3e86cd7ba9de29b2925394a1bb6ab24a52b5652edb25ffa54858ae66b2b3
✓ manifest     MATCH
✓ exits        none (no declarative exits)
✓ site         3 scripts published (run copeybara fingerprint to compare with a build)
✓ website key  0xA2f199fEd2Fecf201422C71e1E53C76Fd6f4d182 may write url only
✓ watcher key  0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8 may write status + blocklist only
✓ safe         2 of 3 signers
✓ status       v=1;state=ok;at=1793998799
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

/* ---------- "Add your protocol": the guided onboarding on the Developers page ---------- */

export interface Cmd { code: string; note?: string }
export interface OnbStep {
  id: string;
  /** short name for the progress rail */
  short: string;
  title: string;
  /** what you do, in one or two plain sentences */
  does: string;
  cmds: Cmd[];
  /** what you should see (real output, shortened with …) */
  see: string;
  /** what "done" means for this step */
  done: string;
  links?: { href: string; label: string }[];
  extra?: 'config' | 'plugins' | 'runbook';
}

const GH = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const ONBOARDING: OnbStep[] = [
  {
    id: 'install',
    short: 'Install',
    title: 'Install the CLI',
    does: 'You need Node 22, pnpm 9, and an ENSv2 name on Sepolia owned by your Safe (2 of 3 or more) with a PermissionedResolver. The packages are not on npm yet, so run them from the repository.',
    cmds: [{ code: `git clone ${REPO_URL} copeybara\ncd copeybara\ncorepack enable && pnpm install\npnpm copeybara help` }],
    see: `copeybara <command> [--config copeybara.config.ts]

  init                     write a copeybara.config.ts to fill in
  manifest [--onchain]     build org.copeybara.manifest (+ org.copeybara.exits); …
  …
Nothing here signs. Owners approve the Safe batch on their own devices.`,
    done: 'The help text prints.',
    links: [{ href: GH('contracts/script/SetupName.s.sol'), label: 'No ENS name yet? SetupName.s.sol sets one up' }],
  },
  {
    id: 'init',
    short: 'Config',
    title: 'Write your config',
    does: 'init writes copeybara.config.ts. Fill in your ENS name, the Safe that owns it, its resolver, the website key (it may write url only), the watcher key (status and blocklist only), your kit file and your exit contracts.',
    cmds: [{ code: 'pnpm copeybara init' }],
    see: 'wrote copeybara.config.ts: fill in the addresses, then run copeybara manifest',
    done: 'Every 0x… in the config is a real address.',
    links: [{ href: GH('examples/demoswap/copeybara.config.ts'), label: 'The live demo’s config' }],
    extra: 'config',
  },
  {
    id: 'exits',
    short: 'Exits',
    title: 'Describe your exits',
    does: 'Built-in adapters cover Uniswap v3 and v4, Aave v3 and Curve 3pool. For your own contracts, add a declarative exit (one function, described in exits) instead of adapter code. manifest refuses anything the Exit Guard could not check; release hashes your kit.',
    cmds: [
      { code: 'pnpm copeybara manifest --onchain', note: 'org.copeybara.manifest, plus org.copeybara.exits if you have spec exits' },
      { code: 'pnpm copeybara release', note: 'your kit’s sha256 for org.copeybara.release' },
    ],
    see: `org.copeybara.manifest → .copeybara/manifest.txt
{"v":1,"c":{"1":{"aave-v3":{"pool":{"a":"0x8787…A4E2","s":["0x69328dec"]}}, …}}}
org.copeybara.release → .copeybara/release.txt
sha256:301d3e86…ae66b2b3;v=7`,
    done: 'Both commands write their file with no “problem” lines.',
    links: [{ href: '#exits', label: 'How declarative exits work' }],
  },
  {
    id: 'fingerprint',
    short: 'Fingerprint',
    title: 'Fingerprint your site',
    does: 'Add the plugin for your bundler. Every build hashes the scripts it ships, writes .well-known/copeybara-site.json, adds a summary to your CI job, and fails on a third-party script without a matching SRI pin. Then turn the build into the record.',
    cmds: [{ code: 'pnpm copeybara fingerprint --dist dist', note: 'or --url https://app.yourprotocol.xyz for a deployed page' }],
    see: `### Copeybara site fingerprint · yourprotocol.eth

✓ 4 script hash(es)
…
org.copeybara.site → .copeybara/site.txt`,
    done: 'site.txt is written and no script is unpinned.',
    extra: 'plugins',
  },
  {
    id: 'propose',
    short: 'Propose',
    title: 'Propose one Safe batch',
    does: 'propose reads what ENS says now and builds one batch: every changed record and the two scoped key grants. Unchanged records are skipped. Root roles, upgrades and other names are refused before the file is written.',
    cmds: [{ code: 'pnpm copeybara propose' }],
    see: `Safe 0x3ae0…057F on chain 11155111 — 6 call(s), one batch:
  1. setText org.copeybara.release = sha256:…;v=1
  2. setText org.copeybara.manifest = {"v":1,"c":{…}}
  3. setText org.copeybara.site = v=2;sha256=…
  4. grant website key 0xA2f1… write access to url only
  5. grant watcher 0xeBbc… write access to org.copeybara.status only
  6. grant watcher 0xeBbc… write access to org.copeybara.blocklist only

Transaction Builder file → .copeybara/safe-batch.json`,
    done: 'You have .copeybara/safe-batch.json and every call is one you expected.',
  },
  {
    id: 'sign',
    short: 'Sign',
    title: 'Sign it in your Safe',
    does: 'In Safe{Wallet}, open Apps → Transaction Builder and drag in .copeybara/safe-batch.json. Check each call against what propose printed, create the batch, and have your owners sign on their own devices. Then execute it.',
    cmds: [{ code: 'pnpm copeybara propose --api --sender 0xYourOwner --signature 0xTheirSignature', note: 'Optional: post it to the Safe Transaction Service with a signature made on the owner’s device (needs safeTxService in the config)' }],
    see: 'The batch in your Safe queue with the same calls propose printed, then executed with at least 2 signatures.',
    done: 'The batch is executed on Sepolia.',
  },
  {
    id: 'verify',
    short: 'Verify',
    title: 'Verify and check the roles',
    does: 'verify reads every record back through three RPCs at one block. roles-check sends each forbidden write as the website and watcher keys (it must revert) next to the same write as the Safe (it must succeed).',
    cmds: [{ code: 'pnpm copeybara verify' }, { code: 'pnpm copeybara roles-check --live' }],
    see: `${VERIFY_OUTPUT}

$ pnpm copeybara roles-check --live
roles-check (live) demoswap-blackout.eth at block 12079469, eth_call through 3 RPCs:
✓ website key     write url                            allowed
✓ website key     write org.copeybara.release          reverted
✓ Safe (control)  write org.copeybara.release          allowed
…
✓ watcher         upgrade the resolver                 reverted

roles-check: OK (35 calls)`,
    done: 'Both end in OK. Any ✗ exits with code 1.',
  },
  {
    id: 'certify',
    short: 'Certify',
    title: 'Get certified',
    does: 'drill forks the chain, switches off your site and primary RPC, and exits a seeded position. certify runs verify, the certified rules, and checks that the drill used this exact kit. Send us certification.json and we add you to the directory.',
    cmds: [{ code: 'pnpm copeybara drill' }, { code: 'pnpm copeybara certify' }],
    see: `✓ certify: website key       url only
✓ certify: watcher           status + blocklist only
✓ drill                      recovered on a fork with the site and primary RPC off (…)

report → .copeybara/certification.json
certify: PASS — send certification.json to Copeybara to be listed with the certified tick.`,
    done: 'certify prints PASS and you have sent us the report.',
    links: [
      { href: `${REPO_URL}/issues/new?title=${encodeURIComponent('Certify: yourprotocol.eth')}`, label: 'Send the report (opens a GitHub issue)' },
      { href: '#/certified', label: 'What certified checks' },
    ],
  },
  {
    id: 'widget',
    short: 'Widget',
    title: 'Add the widget to your footer',
    does: 'Serve copeybara-exit.js from your own site and put the element in your footer. It tells users where the verified kit is and how to check it. It makes no requests, calls no wallet and stores nothing. Include it in your site fingerprint like any other script.',
    cmds: [{ code: 'cp packages/widget/copeybara-exit.js your-site/public/' }, { code: WIDGET_EMBED, note: 'In your footer' }],
    see: 'The card from the live preview below, in your footer, with your ENS name and kit sha256.',
    done: 'The widget shows on your live site.',
    links: [{ href: '#widget', label: 'See the widget running' }],
  },
  {
    id: 'watcher',
    short: 'Watcher',
    title: 'Run the watcher',
    does: 'The watcher checks your live site against the fingerprint and probes look-alike domains. Its key can write only status and blocklist. Put the key in watcher.env (gitignored); the container refuses any other key.',
    cmds: [
      { code: 'pnpm copeybara watcher' },
      { code: 'cp .copeybara/watcher/watcher.env.example .copeybara/watcher/watcher.env', note: 'then set WATCHER_KEY in watcher.env' },
      { code: 'pnpm copeybara watcher --up' },
    ],
    see: `wrote .copeybara/watcher/compose.yml and watcher.env.example
next: cp .copeybara/watcher/watcher.env.example .copeybara/watcher/watcher.env, set WATCHER_KEY, then copeybara watcher --up`,
    done: 'docker compose ps shows the watcher as healthy.',
  },
  {
    id: 'runbook',
    short: 'Runbook',
    title: 'Keep the incident runbook handy',
    does: 'If your site or DNS is hijacked, one Safe batch marks your name compromised and blocks look-alike domains. Extensions following your name block the site before it loads. The exit kit ignores status, so exits keep working.',
    cmds: [{ code: 'pnpm copeybara incident --state compromised --note "Site hijacked. Use your saved exit kit." --block yourprotocol-claim.xyz' }],
    see: `  setText org.copeybara.status = v=1;state=compromised;at=…;note=Site%20hijacked.%20Use%20your%20saved%20exit%20kit.
  setText org.copeybara.blocklist = {"v":1,"domains":["yourprotocol-claim.xyz"]}
Safe batch → .copeybara/incident-batch.json`,
    done: 'Your team knows where this page is.',
    links: [{ href: GH('docs/protocol-integration.md#incident-runbook'), label: 'Full runbook' }],
    extra: 'runbook',
  },
];

/** What to do after a hijack, and when a key leaks. Short version of docs/protocol-integration.md → Incident runbook. */
export const RUNBOOK = [
  { when: 'Site or DNS hijacked', then: 'Run incident --state compromised with --block for look-alikes, sign the batch. The watcher may already have done it. Point users to the kit and your ENS name.' },
  { when: 'Fixed', then: 'Redeploy, fingerprint, propose the new site record, then incident --state ok. A compromised status set by the Safe stays until the Safe clears it.' },
  { when: 'Website key leaked', then: 'It can only change url. Revoke its role through the Safe, rotate it, update websiteKey and propose the new grant.' },
  { when: 'Watcher key leaked', then: 'It can only raise or clear warnings. contracts/script/watcher-role.sh revoke, then rotate and re-grant.' },
];
