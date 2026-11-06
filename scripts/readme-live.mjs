// Fills the README LIVE-DEPLOYMENT section from contracts/deployments/sepolia*.json.
//   node scripts/readme-live.mjs [deployments.json] [README.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dep = process.argv[2] ?? 'contracts/deployments/sepolia.json';
const readme = process.argv[3] ?? 'README.md';
const base = dep.replace(/\.json$/, '');
const d = JSON.parse(readFileSync(dep, 'utf8'));
const perms = existsSync(`${base}-permissions.json`) ? JSON.parse(readFileSync(`${base}-permissions.json`, 'utf8')) : [];
const posFile = `${base}-positions.json`;
const pos = existsSync(posFile) ? JSON.parse(readFileSync(posFile, 'utf8')) : null;
const v4File = `${base}-v4-positions.json`;
const v4 = existsSync(v4File) ? JSON.parse(readFileSync(v4File, 'utf8')) : null;
const tx = (h) => `[\`${h.slice(0, 10)}…\`](https://sepolia.etherscan.io/tx/${h})`;
const ad = (a) => `[\`${a}\`](https://sepolia.etherscan.io/address/${a})`;

const lines = [
  `| What | Value |`, `|---|---|`,
  `| ENS name | \`${d.name}\` |`,
  `| Release Safe (2-of-3, name owner) | ${ad(d.safe)} |`,
  `| PermissionedResolver (per app) | ${ad(d.resolver)} |`,
  `| Website key (url only) | ${ad(d.webKey)} |`,
  ...(d.kitRelease ? [`| Published kit sha256 (\`org.blackout.release\`${d.kitReleaseVersion ? ` v${d.kitReleaseVersion}` : ''}) | \`${d.kitRelease}\` |`] : []),
  '', `Must-revert checks, sent on chain from the website key:`, '',
  `| Check | Result | Tx |`, `|---|---|---|`,
  ...perms.map((p) => `| ${p.check} (must ${p.expected === 'revert' ? 'revert' : 'succeed'}) | ${p.pass ? `${p.status === 'revert' ? 'reverted' : 'succeeded'} ✓` : `FAILED (got ${p.status})`} | ${p.tx ? tx(p.tx) : '—'} |`),
  ...(pos ? ['', `Seeded Uniswap v3 positions (owner ${ad(pos.wallet)}): #${pos.inRange} in range, #${pos.outOfRange} out of range, #${pos.owedOnly} owed only.`] : []),
  ...(v4 ? ['', `Seeded Uniswap v4 positions (owner ${ad(v4.wallet)}, DETH/DUSD 0.3% pool \`${v4.poolId.slice(0, 10)}…\`): #${v4.positions.inRange} in range, #${v4.positions.outOfRange} out of range.`] : []),
];
if (perms.length && perms.some((p) => !p.pass)) throw new Error(`refusing to publish: failing permission checks in ${base}-permissions.json`);
const md = readFileSync(readme, 'utf8');
const out = md.replace(/<!-- LIVE-DEPLOYMENT:START -->[\s\S]*<!-- LIVE-DEPLOYMENT:END -->/, `<!-- LIVE-DEPLOYMENT:START -->\n${lines.join('\n')}\n<!-- LIVE-DEPLOYMENT:END -->`);
if (out === md) throw new Error('LIVE-DEPLOYMENT markers not found');
writeFileSync(readme, out);
console.log(`README live section updated from ${dep}`);
