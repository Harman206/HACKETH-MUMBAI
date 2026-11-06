import type { ExitResult } from './run-exit';

export interface ExitReport {
  kit: { version: number; sha256: string };
  ensName: string;
  startedAt: number;
  failures: { kind: string; at: number }[];
  results: ExitResult[];
  timeToExitSec: number | null;
  guardVerdicts: GuardVerdicts;
  /** Drill-only fields (Fire Drill harness). */
  drill?: { tamperedKitDetected: boolean; hijackApprovalRejected: boolean };
}

export interface GuardVerdicts {
  accepted: number;
  rejected: number;
  unsimulated: number;
  reasons: string[];
}

/** Guard rejections only; dry-run failures are counted separately. */
export function tallyVerdicts(results: ExitResult[]): GuardVerdicts {
  const rejected = results.filter((r) => r.status === 'rejected');
  const unsimulated = results.filter((r) => r.status === 'unsimulated').length;
  return { accepted: results.length - rejected.length - unsimulated, rejected: rejected.length, unsimulated, reasons: rejected.flatMap((r) => r.reasons) };
}

export type ReportInput = Omit<ExitReport, 'timeToExitSec'> & { firstFailureAt?: number; lastReceiptAt?: number };

export function buildReport(input: ReportInput): ExitReport {
  const { firstFailureAt, lastReceiptAt, ...rest } = input;
  const timeToExitSec =
    firstFailureAt !== undefined && lastReceiptAt !== undefined ? Math.round(lastReceiptAt - firstFailureAt) / 1000 : null;
  return { ...rest, timeToExitSec };
}

export function reportToJson(r: ExitReport): string {
  return JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STATUS: Record<ExitResult['status'], string> = { recovered: 'Recovered', 'not-recovered': 'Not recovered', rejected: 'Blocked by the Exit Guard', unsimulated: 'Could not simulate' };

/** Self-contained HTML view of the report (no scripts, no external resources). */
export function reportToHtml(r: ExitReport): string {
  const rows = r.results
    .map((x) => {
      const deltas = Object.keys(x.after)
        .map((t) => `${esc(t)}: ${esc(x.before[t as `0x${string}`] ?? 0n)} → ${esc(x.after[t as `0x${string}`])}`)
        .join('<br>');
      return `<tr><td>${esc(x.positionId)}</td><td>${esc(STATUS[x.status])}</td><td>${x.txHashes.map(esc).join('<br>')}</td><td>${deltas}</td><td>${esc(x.gasUsed)}</td><td>${x.reasons.map(esc).join('<br>')}</td></tr>`;
    })
    .join('');
  const fails = r.failures.map((f) => `<li>${esc(f.kind)} at ${esc(new Date(f.at).toISOString())}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Copeybara exit report</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#111;background:#fff}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top;word-break:break-all}</style></head><body>
<h1>Copeybara exit report</h1>
<p>ENS name: <b>${esc(r.ensName)}</b> · kit v${esc(r.kit.version)} · sha256 <code>${esc(r.kit.sha256)}</code></p>
<p>Time to exit: <b>${r.timeToExitSec === null ? 'n/a' : `${esc(r.timeToExitSec)} s`}</b> · Guard: ${esc(r.guardVerdicts.accepted)} accepted, ${esc(r.guardVerdicts.rejected)} rejected, ${esc(r.guardVerdicts.unsimulated)} could not simulate</p>
${fails ? `<h2>Failures injected</h2><ul>${fails}</ul>` : ''}
${r.drill ? `<p>Tampered kit detected: <b>${r.drill.tamperedKitDetected ? 'yes' : 'no'}</b> · Hijacked site's approval rejected by the Guard: <b>${r.drill.hijackApprovalRejected ? 'yes' : 'no'}</b></p>` : ''}
<h2>Exits</h2><table><tr><th>Position</th><th>Result</th><th>Transactions</th><th>Balances before → after</th><th>Gas</th><th>Reasons</th></tr>${rows}</table>
</body></html>`;
}
