import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, Hex } from 'viem';
import { readCopeybaraRecords } from '@copeybara/ens';
import { guard, explain, type GuardResult } from '@copeybara/guard';
import { createQuorum } from '@copeybara/quorum';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Runs the independent verifier on the tampered kit. Detected = verifier exits 1 (MISMATCH). */
export function checkTamperedKit(tamperedFile: string, ensName: string, ensRpcs: string[]) {
  const three = [ensRpcs[0], ensRpcs[1] ?? ensRpcs[0], ensRpcs[2] ?? ensRpcs[0]] as string[];
  const r = spawnSync('bash', [join(REPO, 'scripts', 'verify-kit.sh'), tamperedFile, ensName, ...three], { encoding: 'utf8' });
  return { detected: r.status === 1 && /MISMATCH/.test(r.stdout), output: r.stdout.trim() || r.stderr.trim() };
}

/** Feeds the hijacked site's request into the same Exit Guard the kit uses, with the manifest from ENS. */
export async function checkHijackRequest(req: { to: Address; data: Hex }, ensName: string, ensRpcs: string[], universalResolver: Address, chainId: number) {
  const rec = await readCopeybaraRecords(ensName, createQuorum({ urls: ensRpcs }), { universalResolver });
  const account = '0x0000000000000000000000000000000000000001' as Address;
  const g = guard({ chainId, from: account, to: req.to, data: req.data, value: 0n }, { account, chainId, manifest: rec.manifest });
  return { rejected: hijackVerdict(g), sentences: explain(g) };
}

/** The hijack request counts as caught only if the Guard rejects it *as a banned approval*. */
export function hijackVerdict(g: GuardResult): boolean {
  return !g.ok && g.reasons.some((r) => r.code === 'BANNED');
}

export interface DrillReport {
  failures: { kind: string; at: number }[];
  timeToExitSec: number | null;
  exitTxHashes: string[];
  balances: { positionId: string; before: Record<string, string>; after: Record<string, string>; status: string }[];
  tamperedKitDetected: boolean;
  tamperedKitVerifier: string;
  hijackApprovalRejected: boolean;
  hijackGuardReasons: string[];
  kitReport: unknown;
}

type KitResult = { positionId: string; status: string; txHashes: string[]; before: Record<string, string>; after: Record<string, string>; confirmedAt?: number };

export function assemble(
  failures: { kind: string; at: number }[],
  kit: { results?: KitResult[] } | null,
  tamper: { detected: boolean; output: string },
  hijack: { rejected: boolean; sentences: string[] },
): DrillReport {
  const results = kit?.results ?? [];
  const confirmed = results.map((r) => r.confirmedAt).filter((x): x is number => typeof x === 'number');
  const first = failures.length ? Math.min(...failures.map((f) => f.at)) : null;
  return {
    failures,
    timeToExitSec: first !== null && confirmed.length ? Math.round(Math.max(...confirmed) - first) / 1000 : null,
    exitTxHashes: results.flatMap((r) => r.txHashes),
    balances: results.map((r) => ({ positionId: r.positionId, before: r.before, after: r.after, status: r.status })),
    tamperedKitDetected: tamper.detected,
    tamperedKitVerifier: tamper.output,
    hijackApprovalRejected: hijack.rejected,
    hijackGuardReasons: hijack.sentences,
    kitReport: kit,
  };
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yes = (b: boolean) => (b ? '<b style="color:#15803d">yes</b>' : '<b style="color:#b91c1c">no</b>');

export function drillReportHtml(r: DrillReport): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Copeybara drill report</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:900px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;word-break:break-all}</style></head><body>
<h1>Copeybara fire drill report</h1>
<p>Time to exit: <b>${r.timeToExitSec === null ? 'n/a' : `${esc(r.timeToExitSec)} s`}</b> (from first injected failure to the last confirmed exit receipt)</p>
<p>Tampered kit detected: ${yes(r.tamperedKitDetected)} · Hijacked site's approval request rejected by the Guard: ${yes(r.hijackApprovalRejected)}</p>
<h2>Failures injected</h2><ul>${r.failures.map((f) => `<li>${esc(f.kind)} at ${esc(new Date(f.at).toISOString())}</li>`).join('')}</ul>
<h2>Exits</h2><table><tr><th>Position</th><th>Status</th><th>Balances before → after</th></tr>${r.balances
    .map((b) => `<tr><td>${esc(b.positionId)}</td><td>${esc(b.status)}</td><td>${Object.keys(b.after).map((t) => `${esc(t)}: ${esc(b.before[t])} → ${esc(b.after[t])}`).join('<br>')}</td></tr>`)
    .join('')}</table>
<h2>Exit transactions</h2><ul>${r.exitTxHashes.map((h) => `<li><code>${esc(h)}</code></li>`).join('')}</ul>
<h2>Guard on the hijack request</h2><ul>${r.hijackGuardReasons.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>Independent verifier on the tampered kit</h2><pre>${esc(r.tamperedKitVerifier)}</pre>
</body></html>`;
}
