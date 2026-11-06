import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..');
let html = '';
let js = '';
beforeAll(() => {
  execFileSync('pnpm', ['build'], { cwd: SITE, stdio: 'pipe' });
  html = readFileSync(join(SITE, 'dist', 'index.html'), 'utf8');
  js = readdirSync(join(SITE, 'dist', 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(SITE, 'dist', 'assets', f), 'utf8')).join('\n');
}, 120_000);

test('no third-party scripts, styles, fonts or analytics', () => {
  expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html + js).not.toMatch(/fonts\.googleapis|google-analytics|googletagmanager|segment\.io|plausible/);
});

test('CSP lets the site fetch its own files (recorded run, kit sha256)', () => {
  expect(html).toMatch(/connect-src 'self' /);
});

test('strict CSP meta with self-only scripts', () => {
  expect(html).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self';/);
});

test('ships the exact kit and its sha256 next to the site', () => {
  const kit = readFileSync(join(SITE, '..', 'kit', 'dist', 'copeybara-kit.html'));
  expect(readFileSync(join(SITE, 'dist', 'copeybara-kit.html')).equals(kit)).toBe(true);
  expect(readFileSync(join(SITE, 'dist', 'copeybara-kit.html.sha256'), 'utf8')).toMatch(/^[0-9a-f]{64}  copeybara-kit.html\n$/);
});

test('service worker: precaches the page and the exact kit; CSP allows only a same-origin worker', () => {
  const sw = readFileSync(join(SITE, 'dist', 'sw.js'), 'utf8');
  const list = JSON.parse(sw.match(/const PRECACHE = (\[.*?\]);/s)![1]!) as string[];
  expect(list).toEqual(expect.arrayContaining(['./', 'copeybara-kit.html', 'copeybara-kit.html.sha256']));
  expect(list.some((f) => f.startsWith('assets/') && f.endsWith('.js'))).toBe(true);
  expect(list).not.toContain('sw.js');
  expect(sw).toMatch(/const CACHE = 'copeybara-[0-9a-f]{12}';/);
  expect(html).toMatch(/worker-src 'self'/);
});

test('qr.svg is the QR code of the public site URL, and is precached for offline use', async () => {
  const { url } = JSON.parse(readFileSync(join(SITE, 'site.json'), 'utf8')) as { url: string };
  expect(url).toMatch(/^https:\/\//);
  const QR = (await import('qrcode')).default;
  const want = await QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  expect(readFileSync(join(SITE, 'dist', 'qr.svg'), 'utf8')).toBe(want);
  expect(readFileSync(join(SITE, 'dist', 'sw.js'), 'utf8')).toContain('"qr.svg"');
});

test('CSP connect-src allows exactly the origins of the default Sepolia RPCs the live proof reads through', async () => {
  const networks = JSON.parse(readFileSync(join(SITE, '..', '..', 'config', 'networks.json'), 'utf8')) as { defaultRpcs: Record<string, string[]> };
  const csp = html.match(/connect-src ([^;]+);/)![1]!.split(' ');
  for (const u of networks.defaultRpcs['11155111']!) expect(csp, u).toContain(new URL(u).origin);
});


test('ships the extension zips (Chrome + Firefox) with matching sha256 files, precached for offline use', () => {
  const sw = readFileSync(join(SITE, 'dist', 'sw.js'), 'utf8');
  for (const browser of ['chrome', 'firefox']) {
    const zip = `copeybara-extension-${browser}.zip`;
    const bytes = readFileSync(join(SITE, 'dist', zip));
    expect(bytes.subarray(0, 4).toString('hex'), zip).toBe('504b0304'); // a real zip
    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(readFileSync(join(SITE, 'dist', `${zip}.sha256`), 'utf8')).toBe(`${sha}  ${zip}\n`);
    expect(sw).toContain(`"${zip}"`);
  }
});

test('the extension section shows the Chrome zip sha256 the site serves, with download links and install steps', async () => {
  const { h, render } = await import('preact');
  const { Extension } = await import('../src/sections/Sections');
  const served = (f: string) => readFileSync(join(SITE, 'dist', f), 'utf8');
  const sha = served('copeybara-extension-chrome.zip.sha256').split(' ')[0]!;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string) => new Response(served(String(u)), { status: 200 })) as typeof fetch;
  try {
    const root = document.createElement('div');
    render(h(Extension, { preview: true }), root);
    for (let i = 0; i < 100 && root.querySelector('[data-ext-sha]')!.textContent !== sha; i++) await new Promise((r) => setTimeout(r, 10));
    expect(root.querySelector('[data-ext-sha]')!.textContent).toBe(sha);
    expect(root.textContent).toContain(served('copeybara-extension-firefox.zip.sha256').split(' ')[0]!);
    const links = Array.from(root.querySelectorAll('a[download]')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['copeybara-extension-chrome.zip', 'copeybara-extension-firefox.zip']);
    expect(root.querySelectorAll('ol.install-steps li')).toHaveLength(4);
    expect(root.textContent).toMatch(/chrome:\/\/extensions.*Developer mode.*Load unpacked/s);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the built page includes the extension section near the top', () => {
  expect(js).toContain('copeybara-extension-chrome.zip');
  expect(js).toContain('Get the Copeybara extension');
});

test('serves <copeybara-exit> byte for byte with its sha256, and the new pages are in the bundle', () => {
  const src = readFileSync(join(SITE, '..', '..', 'packages', 'widget', 'copeybara-exit.js'));
  const served = readFileSync(join(SITE, 'dist', 'copeybara-exit.js'));
  expect(served.equals(src)).toBe(true);
  expect(readFileSync(join(SITE, 'dist', 'copeybara-exit.js.sha256'), 'utf8').split(' ')[0]).toBe(createHash('sha256').update(served).digest('hex'));
  for (const s of ['Ship an exit that outlives your website.', 'A tick you can check yourself.', 'Five verdicts, one decision point']) expect(js).toContain(s);
});
