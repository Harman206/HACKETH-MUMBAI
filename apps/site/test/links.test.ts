import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { h, render } from 'preact';
import { App } from '../src/App';
import { parseRoute } from '../src/router';
import { ONBOARDING } from '../src/developers';

/** Every in-site link resolves: "#/…" to a page, "#id" to an element that page renders. Rendered offline (fetch fails). */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  Element.prototype.scrollIntoView ??= function () {};
  window.scrollTo = () => {};
  globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) => setTimeout(() => f(0), 0)) as typeof requestAnimationFrame;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function renderAt(hash: string) {
  location.hash = hash;
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  render(h(App, {}), root);
  await new Promise((r) => setTimeout(r, 20));
  return root;
}

const PAGES = ['', '#/developers', '#/extension', '#/certified', '#/certified/demoswap-blackout.eth'];

describe('site links', () => {
  test.each(PAGES)('every link on %s goes somewhere', async (hash) => {
    const homeIds = new Set(Array.from((await renderAt('')).querySelectorAll('[id]')).map((e) => e.id).concat('top'));
    const page = await renderAt(hash);
    const ids = new Set(Array.from(page.querySelectorAll('[id]')).map((e) => e.id));
    const hrefs = Array.from(page.querySelectorAll('a[href^="#"]')).map((a) => a.getAttribute('href')!);
    expect(hrefs.length).toBeGreaterThan(3);
    for (const href of hrefs) {
      if (href.startsWith('#/')) {
        const r = parseRoute(href);
        expect(r.page, href).not.toBe('home');
        if ('section' in r && r.section) {
          const target = await renderAt(href);
          expect(target.querySelector(`#${r.section}`), href).not.toBeNull();
          await renderAt(hash);
        }
      } else {
        // An in-page link (Lnk) on a page, or a home-page anchor
        const id = href.slice(1);
        expect(ids.has(id) || homeIds.has(id), `${hash} → ${href}`).toBe(true);
      }
    }
  });

  test('header and home reach Developers, Certified and Extension', async () => {
    const home = await renderAt('');
    const nav = Array.from(home.querySelectorAll('header.top a')).map((a) => a.getAttribute('href'));
    expect(nav).toEqual(expect.arrayContaining(['#/developers', '#/certified', '#/extension']));
    const hero = Array.from(home.querySelectorAll('.hero a')).map((a) => a.getAttribute('href'));
    expect(hero).toEqual(expect.arrayContaining(['#/developers/onboarding', '#/certified', '#/extension']));
  });

  test('the Developers page opens on the guided onboarding with every step', async () => {
    const dev = await renderAt('#/developers/onboarding');
    const steps = Array.from(dev.querySelectorAll('[data-onb-step]')).map((e) => e.getAttribute('data-onb-step'));
    expect(steps).toEqual(ONBOARDING.map((s) => s.id));
    // the first step is open with its command and a copy button
    const first = dev.querySelector('[data-onb-step="install"]')!;
    expect(first.textContent).toContain('pnpm copeybara help');
    expect(first.querySelector('[data-copy]')).not.toBeNull();
    expect(first.querySelector('[data-done-check="install"]')).not.toBeNull();
  });

  test('each certified protocol offers Follow in Copeybara and Open exit kit', async () => {
    const page = await renderAt('#/certified');
    const card = page.querySelector('[data-certified="demoswap-blackout.eth"]')!;
    expect(card.textContent).toContain('Follow in Copeybara');
    expect(card.querySelector('a[href="copeybara-kit.html?ens=demoswap-blackout.eth"]')).not.toBeNull();
    expect(page.textContent).toContain('What certified means');
  });
});
