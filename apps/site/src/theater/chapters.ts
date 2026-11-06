/** The four-chapter story, gating, scoreboard and kit links (pure, testable). */
export interface TDrain { victim: string; token: string; amount: string; approveTx: string; drainTx: string | null; at: number; note?: string }
export interface TState {
  network: 'sepolia' | 'local-fork';
  victim: string | null;
  victimDusd: string | null;
  victimPositions: string[];
  switches: { site: 'up' | 'down'; rpc: 'up' | 'down'; hijack: boolean };
  drains: TDrain[];
  verify: { real: string; tampered: string } | null;
  rescue: unknown;
  chapter: 1 | 2 | 3 | 4;
  prepareTxs: string[];
  prepared?: boolean;
  failures: { kind: string; at: number }[];
  /** The ENS name this booth is running (kit links must use it, not a hard-coded one). */
  ensName?: string;
  tokens: Record<string, string>;
  links: { demoswap: string; kit: string; control: string };
}

export const CHAPTERS = [
  { n: 1, title: 'A normal day', sentence: 'Meet the victim: a normal DemoSwap user with 10,000 DUSD in their wallet and a liquidity position in the DETH/DUSD pool.' },
  { n: 2, title: 'The hijack', sentence: 'An attacker takes over DemoSwap’s domain. The fake site looks identical and asks for one “approval”. One click, and the attacker’s bot empties the wallet.' },
  { n: 3, title: 'The outage', sentence: 'Now the real website is gone and so is the protocol’s RPC server. Normally this is where users are stuck.' },
  { n: 4, title: 'The rescue', sentence: 'The victim opens the BLACKOUT kit they saved earlier. It checks itself against ENS, refuses the attacker’s request, and withdraws the position straight from the contracts.' },
] as const;

export function gate(n: 1 | 2 | 3 | 4, s: TState): { ok: true } | { ok: false; why: string } {
  if (n === 1) return { ok: true };
  if (!s.victim) return { ok: false, why: 'Prepare the victim wallet first (chapter 1).' };
  if (!(s.prepared ?? s.prepareTxs.length > 0)) return { ok: false, why: 'The victim wallet is not fully prepared yet (funding transactions pending or failed).' };
  if (n === 2) return { ok: true };
  if (s.chapter < 2) return { ok: false, why: 'Wait for the drain to land (chapter 2).' };
  if (n === 3) return { ok: true };
  if (s.chapter < 3) return { ok: false, why: 'Take the website and the RPC down first (chapter 3).' };
  return { ok: true };
}

const fmt = (wei: bigint) => {
  const whole = wei / 10n ** 18n;
  const frac = ((wei % 10n ** 18n) * 100n) / 10n ** 18n;
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac.toString().padStart(2, '0').replace(/0$/, '')}` : ''}`;
};

interface RescueResult { status: string; txHashes: string[]; confirmedAt?: number; deltas?: { token: string; before: string; after: string }[] }

export function scoreboard(s: TState) {
  const sym = (t: string) => s.tokens[t] ?? Object.entries(s.tokens).find(([a]) => a.toLowerCase() === t.toLowerCase())?.[1] ?? `${t.slice(0, 6)}…`;
  const sums = (pairs: [string, bigint][]) => {
    const m = new Map<string, bigint>();
    for (const [t, v] of pairs) m.set(t, (m.get(t) ?? 0n) + v);
    return [...m].filter(([, v]) => v > 0n).map(([t, v]) => `${fmt(v)} ${sym(t)}`);
  };
  const drains = s.drains.filter((d) => d.drainTx);
  const results = ((s.rescue as { results?: RescueResult[] })?.results ?? []).filter((r) => r.status === 'recovered');
  const first = s.failures.length ? Math.min(...s.failures.map((f) => f.at)) : null;
  const last = results.map((r) => r.confirmedAt).filter((x): x is number => typeof x === 'number');
  return {
    lost: sums(drains.map((d) => [d.token, BigInt(d.amount)])),
    recovered: sums(results.flatMap((r) => (r.deltas ?? []).map((d) => [d.token, BigInt(d.after) - BigInt(d.before)] as [string, bigint]))),
    timeToExitSec: first !== null && last.length ? Math.round((Math.max(...last) - first) / 100) / 10 : null, // one decimal
    drainTxs: drains.map((d) => d.drainTx!),
    rescueTxs: results.flatMap((r) => r.txHashes),
  };
}

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function kitLinks(s: TState, ensName: string, hijack: { to: string; data: string; value: string }) {
  const exit = `${s.links.kit}/?ens=${encodeURIComponent(ensName)}&drill=${encodeURIComponent(s.links.control)}`;
  return { exit, check: `${exit}&check=${b64url(JSON.stringify(hijack))}` };
}

/** Verifier output → verdict. A provider failure is "could not verify", never shown as a fake kit. */
export function verifyVerdict(out: string): 'match' | 'mismatch' | 'unverified' {
  if (/^MATCH\b/.test(out)) return 'match';
  if (/^MISMATCH\b/.test(out)) return 'mismatch';
  return 'unverified';
}

/** The one thing to do next, for the sticky caption bar (presenter and visitor read the same line). */
export function nextStep(s: TState): { chapter: 1 | 2 | 3 | 4 | 'done'; text: string } {
  if (!s.victim) return { chapter: 1, text: 'Paste a victim wallet (a second MetaMask account works) and press “Prepare victim wallet”.' };
  if (!(s.prepared ?? s.prepareTxs.length > 0)) return { chapter: 1, text: 'Funding the victim wallet with DUSD and a Uniswap position on Sepolia. This takes a few blocks…' };
  if (s.chapter === 1) {
    if (!s.switches.hijack) return { chapter: 2, text: 'Press “Hijack the domain”. DemoSwap’s address will now serve the attacker’s copy.' };
    if (s.drains.length === 0) return { chapter: 2, text: 'Open the fake DemoSwap as the victim, click Connect wallet, and approve the request in MetaMask, as a hurried user would.' };
    return { chapter: 2, text: 'Approval seen. The attacker’s bot is draining the wallet…' };
  }
  if (s.chapter === 2) return { chapter: 3, text: 'Take the website and the RPC down. This is where users are normally stuck.' };
  if (s.chapter === 3) {
    if (!s.verify) return { chapter: 4, text: 'Verify the saved kit against the attacker’s kit: only one matches the fingerprint on ENS.' };
    return { chapter: 4, text: 'Open the kit and exit. It refuses the attacker’s request and withdraws straight from the contracts.' };
  }
  const b = scoreboard(s);
  const time = b.timeToExitSec === null ? '' : ` in ${b.timeToExitSec} s`;
  return {
    chapter: 'done',
    text: `Done. The hijack drained ${b.lost.join(' + ') || 'nothing'}. The saved kit recovered ${b.recovered.join(' + ') || 'nothing'}${time}, with the website and RPC down. Reset to run it again.`,
  };
}
