import { beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
let firstSha = '';

beforeAll(() => {
  execFileSync('node', ['scripts/build.mjs'], { cwd: ROOT, stdio: 'pipe' });
  firstSha = readFileSync(join(DIST, 'copeybara-extension-chrome.zip.sha256'), 'utf8');
}, 300_000);

describe('extension build', () => {
  test('Chrome manifest: MV3, exactly the permissions the design names, shim in MAIN world at document_start', () => {
    const m = JSON.parse(readFileSync(join(DIST, 'chrome', 'manifest.json'), 'utf8'));
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(['storage', 'alarms', 'tabs', 'declarativeNetRequestWithHostAccess', 'sidePanel']);
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(m.content_scripts.map((c: { js: string[]; world?: string; run_at: string }) => [c.js[0], c.world ?? 'ISOLATED', c.run_at])).toEqual([
      ['shim.js', 'MAIN', 'document_start'],
      ['content.js', 'ISOLATED', 'document_start'],
    ]);
    expect(m.content_security_policy.extension_pages).toMatch(/^script-src 'self'/);
    expect(m.web_accessible_resources).toBeUndefined(); // nothing a web page can load or probe
  });
  test('the toolbar icon opens a side panel (Chrome side_panel, Firefox sidebar_action), not a popup', () => {
    const c = JSON.parse(readFileSync(join(DIST, 'chrome', 'manifest.json'), 'utf8'));
    const f = JSON.parse(readFileSync(join(DIST, 'firefox', 'manifest.json'), 'utf8'));
    expect(c.side_panel).toEqual({ default_path: 'src/pages/sidepanel.html' });
    expect(c.sidebar_action).toBeUndefined();
    expect(f.sidebar_action.default_panel).toBe('src/pages/sidepanel.html');
    expect(f.side_panel).toBeUndefined();
    expect(f.permissions).not.toContain('sidePanel');
    for (const m of [c, f]) expect(m.action.default_popup).toBeUndefined();
    const html = readFileSync(join(DIST, 'chrome', 'src/pages/sidepanel.html'), 'utf8');
    expect(html).toMatch(/<script type="module"[^>]+src="\/assets\/sidepanel-[\w-]+\.js"/);
    expect(readFileSync(join(DIST, 'chrome', 'background.js'), 'utf8')).toContain('openPanelOnActionClick');
  });
  test('Firefox manifest uses background scripts and a gecko id', () => {
    const m = JSON.parse(readFileSync(join(DIST, 'firefox', 'manifest.json'), 'utf8'));
    expect(m.background.scripts).toEqual(['background.js']);
    expect(m.browser_specific_settings.gecko.id).toBe('copeybara@copeybara.eth');
  });
  test('no remote code: no eval/Function, no script URLs outside the extension', () => {
    for (const f of files(join(DIST, 'chrome')).filter((x) => /\.(js|html)$/.test(x))) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/<script[^>]+src=["']https?:/);
      expect(t, f).not.toMatch(/\beval\(/);
      expect(t, f).not.toMatch(/new Function\(/);
    }
  });
  test('the shim and content script are self-contained classic scripts (no imports)', () => {
    for (const f of ['shim.js', 'content.js']) {
      const t = readFileSync(join(DIST, 'chrome', f), 'utf8');
      expect(t, f).not.toMatch(/^\s*import\s|\bimport\(/m);
    }
    // the shim must not drag the hashing / guard code into every page
    expect(readFileSync(join(DIST, 'chrome', 'shim.js'), 'utf8').length).toBeLessThan(8000);
  });
  test('reproducible: a second build gives the same zip bytes', () => {
    execFileSync('node', ['scripts/build.mjs'], { cwd: ROOT, stdio: 'pipe' });
    expect(readFileSync(join(DIST, 'copeybara-extension-chrome.zip.sha256'), 'utf8')).toBe(firstSha);
  }, 300_000);
});
