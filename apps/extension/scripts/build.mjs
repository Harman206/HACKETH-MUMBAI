// Builds the extension for Chrome and Firefox, and a reproducible zip for each:
//   dist/chrome/  dist/firefox/  dist/copeybara-extension-{chrome,firefox}.zip (+ .sha256)
// Three Vite passes: (1) worker + trusted pages (ES modules), (2) content script (IIFE), (3) MAIN-world shim (IIFE).
// Same sources → same bytes (fixed zip timestamps, sorted entries, no build-time values). The Chrome zip's sha256
// is what the protocol Safe publishes as org.copeybara.extension.
import { build } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

process.env.NODE_ENV = 'production';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const STAGE = join(DIST, 'stage');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const common = { root: ROOT, configFile: false, logLevel: 'warn', mode: 'production', plugins: [preact()], publicDir: false };

rmSync(DIST, { recursive: true, force: true });

// (1) worker + pages
await build({
  ...common,
  base: '/',
  build: {
    outDir: STAGE,
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: {
        background: join(ROOT, 'src/background/index.ts'),
        popup: join(ROOT, 'src/pages/popup.html'),
        setup: join(ROOT, 'src/pages/setup.html'),
        dashboard: join(ROOT, 'src/pages/dashboard.html'),
        warning: join(ROOT, 'src/pages/warning.html'),
        confirm: join(ROOT, 'src/pages/confirm.html'),
      },
      output: {
        entryFileNames: (c) => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

// (2) + (3) content script and shim: classic scripts, everything inlined
for (const [name, entry] of [['content', 'src/content/index.ts'], ['shim', 'src/shim/index.ts']]) {
  await build({
    ...common,
    build: {
      outDir: STAGE,
      emptyOutDir: false,
      target: 'es2022',
      sourcemap: false,
      reportCompressedSize: false,
      lib: { entry: join(ROOT, entry), formats: ['iife'], name: `copeybara_${name}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  });
}
cpSync(join(ROOT, 'public'), join(STAGE, 'icons'), { recursive: true });

const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [String(s), `icons/icon-${s}.png`]));
const contentScripts = [
  { matches: ['<all_urls>'], js: ['shim.js'], run_at: 'document_start', all_frames: true, match_about_blank: true, world: 'MAIN' },
  { matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start', all_frames: true, match_about_blank: true },
];
const base = {
  manifest_version: 3,
  name: 'Copeybara',
  version: VERSION,
  description: 'Checks DeFi sites against the code their team published on ENS, stops wallet drainers, and gets you out when a site is down or hijacked.',
  icons,
  action: { default_popup: 'src/pages/popup.html', default_title: 'Copeybara', default_icon: icons },
  permissions: ['storage', 'alarms', 'tabs', 'declarativeNetRequestWithHostAccess'],
  host_permissions: ['<all_urls>'],
  content_scripts: contentScripts,
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'none'" },
};
const manifests = {
  chrome: {
    ...base,
    minimum_chrome_version: '116',
    background: { service_worker: 'background.js', type: 'module' },
    web_accessible_resources: [{ resources: ['src/pages/warning.html', 'assets/*'], matches: ['<all_urls>'], use_dynamic_url: true }],
  },
  firefox: {
    ...base,
    background: { scripts: ['background.js'], type: 'module' },
    web_accessible_resources: [{ resources: ['src/pages/warning.html', 'assets/*'], matches: ['<all_urls>'] }],
    browser_specific_settings: { gecko: { id: 'copeybara@copeybara.eth', strict_min_version: '128.0' } },
  },
};

const files = (dir) =>
  readdirSync(dir)
    .flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]))
    .sort();

/** Minimal deterministic zip: sorted entries, DOS time 1980-01-01 00:00, deflate, no extra fields. */
function zip(dir) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files(dir)) {
    const name = Buffer.from(relative(dir, f).split('\\').join('/'));
    const data = readFileSync(f);
    const comp = deflateRawSync(data, { level: 9 });
    const crc = crc32(data) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    locals.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const n = centrals.length / 2;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

for (const [browser, manifest] of Object.entries(manifests)) {
  const out = join(DIST, browser);
  cpSync(STAGE, out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const z = zip(out);
  const file = `copeybara-extension-${browser}.zip`;
  writeFileSync(join(DIST, file), z);
  const sha = createHash('sha256').update(z).digest('hex');
  writeFileSync(join(DIST, `${file}.sha256`), `${sha}  ${file}\n`);
  console.log(`${browser}: dist/${file} sha256 ${sha}`);
}
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
