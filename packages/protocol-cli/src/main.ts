/**
 * copeybara — publish and check a protocol's Copeybara records.
 * Every record write is a Safe proposal; this tool never holds or asks for a private key.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { createPublicClient, getAddress, http, type Hex } from 'viem';
import { COPEYBARA_KEYS, parseSiteRecord, type Address } from '@copeybara/core';
import { readCopeybaraRecords } from '@copeybara/ens';
import { createQuorum, type Quorum } from '@copeybara/quorum';
import { readOnChain } from './chain';
import { certifyLive } from './certify';
import { ensChainId, fromConfig, loadConfig, outDir, rpcsFor, universalResolver, type LoadedConfig } from './config';
import { buildManifest } from './manifest';
import { buildProposal, grantId } from './propose';
import { extensionRelease, kitRelease } from './release';
import { WATCHER_KEYS, WEBSITE_KEYS, type SafeKey } from './resolver';
import { safeApiProposal, safeTxHash } from './safe';
import { compare, failed, formatChecks, type Check } from './verify';
import { INIT_TEMPLATE } from './init';

const HELP = `copeybara <command> [--config copeybara.config.ts]

  init                     write a copeybara.config.ts to fill in
  manifest [--onchain]     build org.copeybara.manifest (+ org.copeybara.exits); refuse what the Exit Guard can't check
  release                  hash the kit (+ extension) into org.copeybara.release / .extension
  fingerprint --dist d     hash every script the built site runs into org.copeybara.site (fails on unpinned third-party scripts)
  fingerprint --url u      same, for a deployed page
  propose                  ONE Safe batch for every changed record + scoped key grants (Transaction Builder JSON)
          [--offline] [--no-grants] [--nonce n] [--api --sender 0x… --signature 0x…]
  verify                   read every record back through 3 RPCs: MATCH / MISMATCH, exit 1 on any problem
  certify                  verify + the Copeybara certified checks; writes certification.json
  roles-check [--live]     prove the website and watcher keys cannot write anything else (fork by default)
  drill [--sample]         fork the chain, switch off the site + primary RPC, exit a seeded position headlessly
  adapter new <name>       scaffold a code adapter with fork tests, Guard corpus cases and property tests

Nothing here signs. Owners approve the Safe batch on their own devices.`;

const say = (s = '') => process.stdout.write(`${s}\n`);
const die = (s: string): never => {
  process.stderr.write(`${s}\n`);
  process.exit(1);
};

async function writeOut(l: LoadedConfig, file: string, body: string) {
  const dir = outDir(l);
  await mkdir(dir, { recursive: true });
  const p = join(dir, file);
  await writeFile(p, body);
  return relative(process.cwd(), p);
}
const readOut = async (l: LoadedConfig, file: string) => (existsSync(join(outDir(l), file)) ? (await readFile(join(outDir(l), file), 'utf8')).trim() : undefined);

const ensQuorum = (l: LoadedConfig): Quorum => createQuorum({ urls: rpcsFor(l.cfg, ensChainId(l.cfg)), expectedChainId: ensChainId(l.cfg), timeoutMs: 10_000 });

async function manifestCmd(l: LoadedConfig, onchain: boolean) {
  const code = onchain
    ? async (chainId: number, address: Address) => createPublicClient({ transport: http(rpcsFor(l.cfg, chainId)[0]) }).getCode({ address }) as Promise<Hex | undefined>
    : undefined;
  const b = await buildManifest(l, { code });
  for (const n of b.notes) say(`  note: ${n}`);
  if (b.problems.length) die(`manifest: ${b.problems.length} problem(s), nothing written:\n  ${b.problems.join('\n  ')}`);
  say(`org.copeybara.manifest → ${await writeOut(l, 'manifest.txt', b.text)}`);
  say(b.text);
  if (b.specText) {
    say(`org.copeybara.exits → ${await writeOut(l, 'exits.txt', b.specText)}`);
    say(b.specText);
  }
  return b;
}

async function releaseCmd(l: LoadedConfig) {
  const k = await kitRelease(fromConfig(l, l.cfg.kit.file), l.cfg.kit.version);
  if (k.problems.length) die(`kit ${l.cfg.kit.file} is not a publishable kit:\n  ${k.problems.join('\n  ')}`);
  say(`org.copeybara.release → ${await writeOut(l, 'release.txt', k.record)}`);
  say(k.record);
  let ext: string | undefined;
  if (l.cfg.extension) {
    const e = await extensionRelease(fromConfig(l, l.cfg.extension.file), l.cfg.extension.version, l.cfg.extension.tree);
    ext = e.record;
    say(`org.copeybara.extension → ${await writeOut(l, 'extension.txt', e.record)}`);
    say(e.record);
  }
  return { kit: k, ext };
}

async function desired(l: LoadedConfig, siteFlag?: string): Promise<Partial<Record<SafeKey, string>>> {
  const K = COPEYBARA_KEYS;
  const m = await buildManifest(l);
  if (m.problems.length) die(`manifest: run copeybara manifest first:\n  ${m.problems.join('\n  ')}`);
  const r = await releaseCmd(l);
  const v: Partial<Record<SafeKey, string>> = { [K.release]: r.kit.record, [K.manifest]: m.text };
  if (m.specText) v[K.exits] = m.specText;
  if (r.ext) v[K.extension] = r.ext;
  const site = siteFlag ?? (await readOut(l, 'site.txt'));
  if (site) {
    parseSiteRecord(site);
    v[K.site] = site;
  } else say('  note: no site fingerprint (run copeybara fingerprint); org.copeybara.site is left as it is');
  return v;
}

async function proposeCmd(l: LoadedConfig, o: Record<string, string | boolean | undefined>) {
  const { cfg } = l;
  const values = await desired(l, o.site as string | undefined);
  let current: Record<string, string> | undefined;
  let granted: Set<string> | undefined;
  let nonce = o.nonce !== undefined ? BigInt(o.nonce as string) : undefined;
  if (!o.offline) {
    const accounts = [cfg.websiteKey, ...(cfg.watcher ? [cfg.watcher.key] : [])];
    const s = await readOnChain({ q: ensQuorum(l), name: cfg.name, universalResolver: universalResolver(cfg), resolver: cfg.resolver, safe: cfg.safe, accounts });
    if (s.resolver.toLowerCase() !== cfg.resolver.toLowerCase()) die(`${cfg.name} resolves through ${s.resolver}, not the configured resolver ${cfg.resolver}.`);
    current = s.texts;
    granted = new Set();
    for (const [acct, keys] of [[cfg.websiteKey, WEBSITE_KEYS], ...(cfg.watcher ? [[cfg.watcher.key, WATCHER_KEYS]] : [])] as [Address, readonly string[]][]) {
      for (const k of keys) if (((s.roles[acct.toLowerCase()]?.[k] ?? 0n) & 16n) !== 0n) granted.add(grantId(acct, k));
    }
    nonce ??= s.safe?.nonce;
  }
  const p = buildProposal({ cfg, ensChainId: ensChainId(cfg), values, current, granted, grants: !o['no-grants'], createdAt: Date.now() });
  for (const s of p.skipped) say(`  skip  ${s}`);
  if (!p.calls.length) return say('Nothing to propose: ENS already says what the config says.');
  say(`\nSafe ${cfg.safe} on chain ${ensChainId(cfg)} — ${p.calls.length} call(s), one batch:`);
  p.calls.forEach((c, i) => say(`  ${i + 1}. ${c.label}`));
  say(`\nTransaction Builder file → ${await writeOut(l, 'safe-batch.json', JSON.stringify(p.batch, null, 2))}`);
  say('  Safe{Wallet} → Apps → Transaction Builder → drag the file in → Create batch → owners sign on their own devices.');
  if (nonce !== undefined) {
    const tx = { ...p.multiSend, nonce };
    const hash = safeTxHash(cfg.safe, ensChainId(cfg), tx);
    await writeOut(l, 'safe-tx.json', JSON.stringify({ safe: cfg.safe, chainId: ensChainId(cfg), ...tx, value: '0', nonce: nonce.toString(), safeTxHash: hash }, null, 2));
    say(`\nAs one MultiSendCallOnly transaction (nonce ${nonce}): safeTxHash ${hash}`);
    if (o.api) {
      const service = cfg.safeTxService ?? die('propose --api needs safeTxService in the config');
      if (!o.sender || !o.signature) die(`propose --api needs --sender <owner> and --signature <owner's signature of ${hash}>, made on the owner's own device.`);
      const body = safeApiProposal(cfg.safe, ensChainId(cfg), tx, getAddress(o.sender as string), o.signature as Hex);
      const res = await fetch(`${service.replace(/\/$/, '')}/api/v1/safes/${cfg.safe}/multisig-transactions/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) die(`Safe Transaction Service refused the proposal: ${res.status} ${await res.text()}`);
      say(`Proposed to ${service}: the other owners will see it in their Safe queue.`);
    }
  }
}

async function verifyChecks(l: LoadedConfig): Promise<{ checks: Check[]; block: bigint }> {
  const { cfg } = l;
  const m = await buildManifest(l);
  if (m.problems.length) die(`the config's manifest has problems:\n  ${m.problems.join('\n  ')}`);
  const k = await kitRelease(fromConfig(l, cfg.kit.file), cfg.kit.version);
  const ext = cfg.extension ? (await extensionRelease(fromConfig(l, cfg.extension.file), cfg.extension.version, cfg.extension.tree)).record : undefined;
  const siteText = await readOut(l, 'site.txt');
  const q = ensQuorum(l);
  const s = await readOnChain({ q, name: cfg.name, universalResolver: universalResolver(cfg), resolver: cfg.resolver, safe: cfg.safe, accounts: [cfg.websiteKey, ...(cfg.watcher ? [cfg.watcher.key] : [])] });
  const checks = compare(
    {
      name: cfg.name,
      resolver: cfg.resolver,
      safe: cfg.safe,
      websiteKey: cfg.websiteKey,
      watcher: cfg.watcher?.key,
      kit: { sha256: k.sha256, version: cfg.kit.version },
      manifest: m.text,
      exits: m.specText,
      site: siteText ? (parseSiteRecord(siteText) ?? undefined) : undefined,
      extension: ext,
    },
    s,
  );
  const records = await readCopeybaraRecords(cfg.name, q, { universalResolver: universalResolver(cfg) }).catch((e: Error) => e);
  if (records instanceof Error) checks.push({ name: 'kit view', level: 'fail', detail: `the kit would stop: ${records.message}` });
  else if (records.problems.length) checks.push({ name: 'kit view', level: 'fail', detail: records.problems.map((p) => `${p.key}: ${p.message}`).join('; ') });
  else checks.push({ name: 'kit view', level: 'ok', detail: 'the kit reads every record without a problem' });
  return { checks, block: s.block };
}

async function verifyCmd(l: LoadedConfig) {
  const { checks, block } = await verifyChecks(l);
  say(`${l.cfg.name} at Sepolia block ${block} (3 RPCs, ≥2 agreeing):`);
  say(formatChecks(checks));
  if (failed(checks)) die('\nverify: FAILED');
  say('\nverify: OK');
}

async function certifyCmd(l: LoadedConfig) {
  const { cfg } = l;
  const watcher = cfg.watcher ?? die('certify: a watcher (status + blocklist only) is required for Copeybara certified.');
  const { checks, block } = await verifyChecks(l);
  const q = ensQuorum(l);
  const s = await readOnChain({ q, name: cfg.name, universalResolver: universalResolver(cfg), resolver: cfg.resolver, safe: cfg.safe, accounts: [cfg.websiteKey, watcher.key] });
  const records = await readCopeybaraRecords(cfg.name, q, { universalResolver: universalResolver(cfg) }).catch((e: Error) => e);
  const live = certifyLive({ resolver: cfg.resolver, websiteKey: cfg.websiteKey, watcher: watcher.key }, s, records);
  const drill = await readOut(l, 'drill.json');
  const d = drill ? (JSON.parse(drill) as { pass?: boolean; kitSha256?: string; at?: string }) : null;
  const kitSha = (await kitRelease(fromConfig(l, cfg.kit.file), cfg.kit.version)).sha256;
  const drillCheck: Check = !d
    ? { name: 'drill', level: 'fail', detail: 'no drill report: run copeybara drill' }
    : d.pass && d.kitSha256 === kitSha
      ? { name: 'drill', level: 'ok', detail: `recovered on a fork with the site and primary RPC off (${d.at})` }
      : { name: 'drill', level: 'fail', detail: d.pass ? 'the drill ran with a different kit: run it again' : 'the last drill did not recover the position' };
  const all = [...checks, ...live.map((c) => ({ ...c, name: `certify: ${c.name}` })), drillCheck];
  say(`${cfg.name} at block ${block}:`);
  say(formatChecks(all));
  const report = { name: cfg.name, block: block.toString(), at: new Date().toISOString(), kitSha256: kitSha, pass: !failed(all), checks: all };
  say(`\nreport → ${await writeOut(l, 'certification.json', JSON.stringify(report, null, 2))}`);
  if (!report.pass) die('certify: NOT YET — fix the ✗ lines and run again.');
  say('certify: PASS — send certification.json to Copeybara to be listed with the certified tick. The tick is re-checked live from ENS on every view.');
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return say(HELP);
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'copeybara.config.ts' },
      onchain: { type: 'boolean' },
      offline: { type: 'boolean' },
      'no-grants': { type: 'boolean' },
      nonce: { type: 'string' },
      api: { type: 'boolean' },
      sender: { type: 'string' },
      signature: { type: 'string' },
      site: { type: 'string' },
      dist: { type: 'string' },
      url: { type: 'string' },
      live: { type: 'boolean' },
      force: { type: 'boolean' },
      sample: { type: 'boolean' },
    },
  });
  if (cmd === 'init') {
    if (existsSync(o.config!) && !o.force) die(`${o.config} exists (use --force to overwrite).`);
    await writeFile(o.config!, INIT_TEMPLATE);
    return say(`wrote ${o.config}: fill in the addresses, then run copeybara manifest`);
  }
  if (cmd === 'drill' && o.sample) {
    const dir = '.copeybara';
    const { drillCmd } = await import('./drill');
    return void (await drillCmd(null, { sample: true, write: async (f, b) => (await mkdir(dir, { recursive: true }), await writeFile(join(dir, f), b), join(dir, f)) }));
  }
  if (cmd === 'adapter') return (await import('./scaffold')).adapterNew(positionals[1] ?? die('usage: copeybara adapter new <name>'));
  const l = await loadConfig(o.config);
  switch (cmd) {
    case 'manifest':
      return void (await manifestCmd(l, !!o.onchain));
    case 'release':
      return void (await releaseCmd(l));
    case 'propose':
      return proposeCmd(l, o);
    case 'verify':
      return verifyCmd(l);
    case 'certify':
      return certifyCmd(l);
    case 'fingerprint':
      return (await import('./fingerprint')).fingerprintCmd(l, { dist: o.dist, url: o.url, write: (f, b) => writeOut(l, f, b) });
    case 'roles-check':
      return (await import('./roles')).rolesCheckCmd(l, { live: !!o.live });
    case 'drill':
      return (await import('./drill')).drillCmd(l, { write: (f, b) => writeOut(l, f, b) });
    default:
      die(`unknown command ${cmd}\n\n${HELP}`);
  }
}

await main().catch((e: Error) => die(`copeybara: ${e.message}`));
