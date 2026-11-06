import { describe, expect, test } from 'vitest';
import { boothUrl } from '../src/theater/api';
import { CHAPTERS, gate, scoreboard, kitLinks, type TState } from '../src/theater/chapters';

const DUSD = '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA';
const DETH = '0x62715d2762949Ab8Fb124eB01f78898Feb8a596A';
const base: TState = {
  network: 'sepolia', victim: null, victimDusd: null, victimPositions: [], switches: { site: 'up', rpc: 'up', hijack: false },
  drains: [], verify: null, rescue: null, chapter: 1, prepareTxs: [], failures: [],
  tokens: { [DUSD]: 'DUSD', [DETH]: 'DETH' }, links: { demoswap: 'http://demoswap.localhost:8080', kit: 'http://localhost:8000', control: 'http://localhost:8090' },
};

describe('booth url', () => {
  test('accepts only localhost / 127.0.0.1 http URLs', () => {
    expect(boothUrl('https://x.github.io/?booth=http://localhost:8090')).toBe('http://localhost:8090');
    expect(boothUrl('https://x.github.io/?booth=http://127.0.0.1:8090/')).toBe('http://127.0.0.1:8090');
    expect(boothUrl('https://x.github.io/?booth=https://evil.example')).toBeNull();
    expect(boothUrl('https://x.github.io/')).toBeNull();
  });
});

describe('chapters', () => {
  test('four chapters with a sentence and an action each', () => {
    expect(CHAPTERS.map((c) => c.title)).toEqual(['A normal day', 'The hijack', 'The outage', 'The rescue']);
    for (const c of CHAPTERS) expect(c.sentence.length).toBeGreaterThan(20);
  });

  test('gating explains why a step is not available yet (out-of-order safe)', () => {
    expect(gate(2, base)).toEqual({ ok: false, why: 'Prepare the victim wallet first (chapter 1).' });
    expect(gate(3, { ...base, victim: '0x1' })).toEqual({ ok: false, why: 'Wait for the drain to land (chapter 2).' });
    expect(gate(4, { ...base, victim: '0x1', chapter: 2 })).toEqual({ ok: false, why: 'Take the website and the RPC down first (chapter 3).' });
    expect(gate(4, { ...base, victim: '0x1', chapter: 3 }).ok).toBe(true);
    expect(gate(1, base).ok).toBe(true);
  });

  test('scoreboard: lost (drains), recovered (kit deltas), time to exit', () => {
    const s: TState = {
      ...base, victim: '0x1', chapter: 4,
      drains: [{ victim: '0x1', token: DUSD, amount: (10_000n * 10n ** 18n).toString(), approveTx: '0xa', drainTx: '0xd', at: 1000 }],
      failures: [{ kind: 'site-down', at: 10_000 }, { kind: 'rpc-down', at: 12_000 }],
      rescue: { results: [{ status: 'recovered', txHashes: ['0xr'], confirmedAt: 52_500, deltas: [{ token: DUSD, before: '0', after: (999n * 10n ** 18n).toString(), min: '1' }, { token: DETH, before: '5', after: (5n + 10n ** 18n).toString(), min: '1' }] }] },
    };
    expect(scoreboard(s)).toEqual({ lost: ['10,000 DUSD'], recovered: ['999 DUSD', '1 DETH'], timeToExitSec: 42.5, drainTxs: ['0xd'], rescueTxs: ['0xr'] });
  });

  test('kit links: drill settings and the pre-filled hijack check', () => {
    const l = kitLinks(base, 'demoswap-blackout.eth', { to: DUSD, data: '0x095ea7b3', value: '0x0' });
    expect(l.exit).toBe('http://localhost:8000/?ens=demoswap-blackout.eth&drill=http%3A%2F%2Flocalhost%3A8090');
    const check = new URL(l.check);
    expect(JSON.parse(Buffer.from(check.searchParams.get('check')!, 'base64url').toString())).toEqual({ to: DUSD, data: '0x095ea7b3', value: '0x0' });
  });
});
