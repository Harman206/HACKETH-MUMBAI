import type { GuardResult } from '@copeybara/guard';
import { explain } from '@copeybara/guard';
import type { Fixture } from '../fixtures/schema';
import type { LpExit } from './exits-at-block';

export const LABELS = ['mainnet fork', 'impersonated account', 'counterfactual'] as const;

export interface ReplayResult {
  fixture: Fixture;
  lossWithout: bigint;
  lossWith: bigint;
  guard: GuardResult;
  exits: LpExit[];
  usd: Record<string, number | null>;
}

const fmt = (amount: bigint, decimals: number) => {
  const s = amount.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals) || '0';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${s.slice(-decimals).slice(0, 2)}`;
};
const usdOf = (amount: bigint, decimals: number, price: number | null | undefined) =>
  price == null ? 'n/a' : `$${((Number(amount) / 10 ** decimals) * price).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function buildReplayReport(results: ReplayResult[]): { md: string; html: string } {
  const md: string[] = ['# Copeybara Incident Replay Lab', '', `Every result here is labelled **${LABELS.join('**, **')}**. Nothing is a live mainnet rescue.`, ''];
  for (const r of results) {
    const loss = r.fixture.lossObserved!;
    md.push(`## ${r.fixture.id}: ${r.fixture.incident}`, '');
    md.push(`Fork block ${r.fixture.forkBlock} (just before the victim's approval at ${r.fixture.approveBlock}).`, '');
    md.push('| | Without Copeybara | With Copeybara |', '|---|---|---|');
    md.push(
      `| Victim loss (USDC) [mainnet fork] | ${fmt(r.lossWithout, loss.decimals)} (${usdOf(r.lossWithout, loss.decimals, r.usd[loss.token.toLowerCase()])}) | ${fmt(r.lossWith, loss.decimals)} [counterfactual] |`,
    );
    md.push(`| Victim's real approve calldata through the Exit Guard | (signed on the fake site) | **${r.guard.ok ? 'accepted' : 'rejected'}**: ${explain(r.guard).join(' ')} |`, '');
    md.push('### LP exits at the incident block [mainnet fork] [impersonated account]', '');
    md.push('| LP | Position | Result | Tokens out | USD at fork block | Gas | Tx |', '|---|---|---|---|---|---|---|');
    for (const e of r.exits) {
      const outs = e.tokens.map((t) => {
        const d = (e.result.after[t.address] ?? 0n) - (e.result.before[t.address] ?? 0n);
        return { text: `${fmt(d, t.decimals)} ${t.symbol}`, usd: usdOf(d, t.decimals, r.usd[t.address.toLowerCase()]) };
      });
      md.push(`| \`${e.account}\` | ${e.label} | ${e.result.status} | ${outs.map((o) => o.text).join('<br>')} | ${outs.map((o) => o.usd).join('<br>')} | ${e.result.gasUsed} | ${e.result.txHashes.map((h) => `\`${h.slice(0, 10)}…\``).join(' ')} |`);
    }
    md.push('', 'Sources:', ...r.fixture.sources.map((s) => `- ${s}`), '');
  }
  const body = md.join('\n');
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Copeybara replay report</title><style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1000px}pre{white-space:pre-wrap}</style></head><body><pre>${esc(body)}</pre></body></html>`;
  return { md: body, html };
}
