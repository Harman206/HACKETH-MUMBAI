// Generates public/icon-{16,32,48,128}.png from the brand mark (assets/brand/copeybara-mark.svg): the lime capybara
// on a near-black rounded tile. Rasterized with Playwright's Chromium (a dev dependency). Run once and commit the PNGs:
//   node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public');
mkdirSync(OUT, { recursive: true });

// the official mark, with the square tile rounded for a toolbar icon
const mark = readFileSync(join(ROOT, '..', '..', 'assets', 'brand', 'copeybara-mark.svg'), 'utf8').replace(
  '<rect width="104" height="104"',
  '<rect width="104" height="104" rx="24"',
);

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  const svg = mark.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: join(OUT, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written to', OUT);
