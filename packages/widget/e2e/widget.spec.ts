import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WIDGET = readFileSync(fileURLToPath(new URL('../copeybara-exit.js', import.meta.url)));
const PAGE = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'">
<script src="/wallet.js"></script>
<script src="/copeybara-exit.js"></script></head><body>
<copeybara-exit ens="demoswap-blackout.eth" kit="/copeybara-kit.html" sha256="${'ab'.repeat(32)}" extension="/ext.zip" extension-sha256="${'cd'.repeat(32)}" certified></copeybara-exit>
</body></html>`;
/** An EIP-1193 + EIP-6963 wallet that records every call made to it. */
const WALLET = `window.__walletCalls = [];
const provider = { request: (a) => { window.__walletCalls.push(a && a.method); return Promise.resolve(null); }, on() {}, removeListener() {} };
window.ethereum = new Proxy(provider, { get(t, k) { if (k !== 'request' && k !== 'on' && k !== 'removeListener') window.__walletCalls.push('get:' + String(k)); return t[k]; } });
window.addEventListener('eip6963:requestProvider', () => window.__walletCalls.push('eip6963:requestProvider'));`;

let server: Server;
let origin = '';
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const body = req.url === '/copeybara-exit.js' ? WIDGET : req.url === '/wallet.js' ? WALLET : req.url === '/' ? PAGE : null;
    if (body === null) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html' : 'text/javascript' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(() => new Promise<void>((r) => server.close(() => r())));

test('renders under a strict CSP with 0 third-party requests, 0 wallet calls and no cookies or storage', async ({ page, context }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`${origin}/`);
  const card = page.locator('copeybara-exit');
  await expect(card.getByText('Verify this file against demoswap-blackout.eth before you use it. This website cannot vouch for itself.')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Download the exit kit' })).toHaveAttribute('href', `${origin}/copeybara-kit.html`);
  await expect(card.getByRole('link', { name: /Copeybara certified/ })).toHaveAttribute('href', 'https://blackout-red.vercel.app/#/certified/demoswap-blackout.eth');
  await page.waitForTimeout(500);

  expect(requests.filter((u) => !u.startsWith(origin))).toEqual([]);
  expect(requests.map((u) => new URL(u).pathname).sort()).toEqual(['/', '/copeybara-exit.js', '/wallet.js']);
  expect(await page.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls)).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});
