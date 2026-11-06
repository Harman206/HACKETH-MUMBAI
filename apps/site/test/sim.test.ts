import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { h, render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { HeroSim, PanelSim, PHASES, SimPanel, kitStateOf, tileCounts, type Phase } from '../src/sections/ProductSim';
import { TILES } from '../src/sim';

/** The product simulations on the landing and extension heroes (sections/ProductSim.tsx). */
const REPO = join(__dirname, '..', '..', '..');
const run = JSON.parse(readFileSync(join(REPO, 'demo-runs', 'latest.json'), 'utf8')) as { recovered: string; victim: string };
const deployment = JSON.parse(readFileSync(join(REPO, 'contracts', 'deployments', 'sepolia.json'), 'utf8')) as { kitReleaseVersion: number };

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
  document.body.replaceChildren();
});

function mount(vnode: ComponentChild) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  act(() => render(vnode, root));
  return root;
}
const reduce = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
};
const at = (p: Phase) => PHASES.findIndex(([n]) => n === p);

describe('hero simulation', () => {
  test('renders the kit in a browser window with the side panel and all its sections', () => {
    const el = mount(h(HeroSim, {}));
    const fig = el.querySelector('[data-hero-sim]')!;
    expect(fig.getAttribute('data-layout')).toBe('browser');
    const panel = fig.querySelector('[data-sim-panel]')!;
    expect(panel.textContent).toContain('Your DeFi safety net');
    expect(panel.textContent).toContain('Protected');
    for (const s of ['site', 'positions', 'protocols', 'activity']) expect(panel.querySelector(`[data-sim-section="${s}"]`), s).not.toBeNull();
    expect(panel.querySelectorAll('.sp-positions li')).toHaveLength(4);
    expect(panel.textContent).toContain('Uniswap v4 #41449');
    expect(panel.textContent).toContain(`Exit kit v${deployment.kitReleaseVersion}`);
    expect(panel.querySelectorAll('[data-stats] .sp-tile')).toHaveLength(TILES.length);
    expect(panel.querySelector('[data-site]')!.getAttribute('data-site')).toBe('match');

    const kit = fig.querySelector('[data-sim-kit]')!;
    expect(kit.textContent).toContain('Verified on ENS');
    expect(kit.textContent).toContain(`Release v${deployment.kitReleaseVersion}`);
    expect(kit.textContent).toContain(run.recovered);
    expect(kit.textContent).toContain(`${run.victim.slice(0, 6)}…${run.victim.slice(-4)}`);
    expect(kit.querySelectorAll('.sk-rail li')).toHaveLength(4);
    expect(fig.querySelector('figcaption')!.textContent).toMatch(/last recorded Sepolia rescue/);
  });

  test('with reduced motion it is one static frame', async () => {
    reduce(true);
    const el = mount(h(HeroSim, {}));
    const panel = el.querySelector('[data-sim-panel]')!;
    expect(panel.hasAttribute('data-static')).toBe(true);
    await new Promise((r) => setTimeout(r, PHASES[0]![1] + 300));
    expect(panel.getAttribute('data-phase')).toBe('calm');
    expect(panel.querySelector('[data-site]')!.getAttribute('data-site')).toBe('match');
    expect(panel.querySelector('[data-sim-toast]')!.getAttribute('data-sim-toast')).toBe('hidden');
    const shown = Array.from(panel.querySelectorAll('[data-stats] b')).map((b) => Number(b.textContent));
    expect(shown).toEqual(TILES.map((t) => t.base));
  }, 8000);

  test('the extension page panel renders on its own', () => {
    const el = mount(h(PanelSim, {}));
    expect(el.querySelector('[data-panel-sim] [data-sim-panel]')).not.toBeNull();
    expect(el.querySelector('[data-sim-kit]')).toBeNull();
  });
});

describe('the loop', () => {
  const st = (phase: Phase, loop = 0) => ({ phase, i: at(phase), loop, running: true });
  test('the site card turns red when the code stops matching, then back', () => {
    const verdict = (p: Phase) => mount(h(SimPanel, { st: st(p) })).querySelector('[data-site]')!.getAttribute('data-site');
    expect(verdict('calm')).toBe('match');
    expect(verdict('hijack')).toBe('mismatch');
    expect(verdict('rescued')).toBe('mismatch');
    expect(verdict('back')).toBe('match');
  });
  test('the drainer request slides in, is cancelled, and leaves', () => {
    const toast = (p: Phase) => mount(h(SimPanel, { st: st(p) })).querySelector('[data-sim-toast]')!.getAttribute('data-sim-toast');
    expect(toast('calm')).toBe('hidden');
    expect(toast('drainer')).toBe('ask');
    expect(toast('cancelled')).toBe('done');
    expect(toast('scroll')).toBe('hidden');
  });
  test('the kit exits and recovers; counters only go up', () => {
    expect(PHASES.map(([, ], i) => kitStateOf(i))).toEqual(['ready', 'ready', 'ready', 'ready', 'ready', 'exiting', 'done', 'done']);
    let prev = tileCounts(0, 0);
    for (let loop = 0; loop < 3; loop++)
      for (let i = 0; i < PHASES.length; i++) {
        const c = tileCounts(i, loop);
        for (const t of TILES) expect(c[t.key]).toBeGreaterThanOrEqual(prev[t.key]);
        prev = c;
      }
    expect(tileCounts(at('cancelled'), 0).requestsBlocked).toBe(TILES.find((t) => t.key === 'requestsBlocked')!.base + 1);
  });
});
