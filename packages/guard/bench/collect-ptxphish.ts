/**
 * B1b: the PTXPhish dataset (Chen et al., "Dissecting Payload-based Transaction Phishing on Ethereum", NDSS 2025,
 * github.com/blocksecteam/PTXPhish, dataset/PTXPHISH.xlsx). Labeled mainnet tx hashes per phishing subtype plus benign
 * KOL / developer txs. We sample each column (seeded), fetch the real tx, and rebuild the request the user was shown.
 *   ../../node_modules/.bin/tsx bench/collect-ptxphish.ts [perColumn=120]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEventLog, getAddress, keccak256, parseAbi, toBytes, type Hex } from 'viem';
import { CACHE, rpc, scan, shuffle, writeJson } from './lib';
import { PERMIT2, reconstruct, type Req } from './reconstruct';

const PER = Number(process.argv[2] ?? 120);
const URL_ = 'https://github.com/blocksecteam/PTXPhish/raw/main/dataset/PTXPHISH.xlsx';
const COLS: Record<string, { label: string; malicious: boolean }> = {
  A: { label: 'Approve', malicious: true },
  C: { label: 'Permit', malicious: true },
  E: { label: 'SetApproveForAll', malicious: true },
  H: { label: 'NFT bulk transfer', malicious: true },
  J: { label: 'Proxy upgrade', malicious: true },
  L: { label: 'Free buy order', malicious: true },
  O: { label: 'Address poisoning: zero value transfer', malicious: true },
  Q: { label: 'Address poisoning: fake token transfer', malicious: true },
  S: { label: 'Address poisoning: dust value transfer', malicious: true },
  V: { label: 'Payable: airdrop function', malicious: true },
  X: { label: 'Payable: wallet function', malicious: true },
  AA: { label: 'Benign KOL', malicious: false },
  AB: { label: 'Benign developer', malicious: false },
};

function readXlsx(): Record<string, string[]> {
  const dir = join(CACHE, 'ptxphish');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'PTXPHISH.xlsx');
  execFileSync('curl', ['-sL', '-o', file, URL_]);
  const unz = (p: string) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 28 }).toString('utf8');
  const ss = [...unz('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1]!.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(''));
  const out: Record<string, string[]> = {};
  for (const m of unz('xl/worksheets/sheet1.xml').matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(?:<v>([^<]*)<\/v>|<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>[\s\S]*?<\/is>)/g)) {
    const [, col, row, attrs, v, inl] = m;
    if (Number(row) <= 4) continue;
    const val = (inl ?? (/t="s"/.test(attrs!) ? ss[Number(v)] : v) ?? '').trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(val)) (out[col!] ??= []).push(val.toLowerCase());
  }
  return out;
}

const APPROVAL = keccak256(toBytes('Approval(address,address,uint256)'));
const P2PERMIT = keccak256(toBytes('Permit(address,address,address,uint160,uint48,uint48)'));
const AFA = keccak256(toBytes('ApprovalForAll(address,address,bool)'));

/** Permit submitted through a drainer contract: rebuild the signed message from the receipt's events (unverified). */
async function fromReceipt(tx: any, id: string): Promise<Req | null> {
  const rc = await rpc('eth_getTransactionReceipt', [tx.hash]);
  // A Permit2 Permit naming the spender is the request that matters; a token permit *for Permit2* in the same tx is only step one.
  const logs = [...(rc?.logs ?? [])].sort((a: any, b: any) => Number(b.topics[0] === P2PERMIT) - Number(a.topics[0] === P2PERMIT));
  for (const l of logs) {
    if (l.topics[0] === P2PERMIT && l.address.toLowerCase() === PERMIT2.toLowerCase()) {
      const ev = decodeEventLog({ abi: parseAbi(['event Permit(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration, uint48 nonce)']), data: l.data, topics: l.topics }).args as any;
      const td = { domain: { name: 'Permit2', chainId: 1, verifyingContract: PERMIT2 }, primaryType: 'PermitSingle', types: { PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }], PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }] }, message: { details: { token: ev.token, amount: ev.amount, expiration: ev.expiration, nonce: ev.nonce }, spender: ev.spender, sigDeadline: 0 } };
      return { id, category: 'sig.permit2.single', provenance: 'reconstructed-unverified', tx: tx.hash, block: Number(tx.blockNumber), account: getAddress(ev.owner), counterparty: getAddress(ev.spender), request: { method: 'eth_signTypedData_v4', params: [ev.owner, JSON.stringify(td, (_, x) => (typeof x === 'bigint' ? x.toString() : x))] }, note: 'from Permit2 Permit event (submitted via another contract)' };
    }
    if (l.topics[0] === APPROVAL && l.topics.length === 3) {
      const owner = getAddress('0x' + l.topics[1].slice(26));
      const spender = getAddress('0x' + l.topics[2].slice(26));
      if (owner.toLowerCase() === tx.from.toLowerCase()) continue;
      const td = { domain: { name: '?', version: '1', chainId: 1, verifyingContract: getAddress(l.address) }, primaryType: 'Permit', types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] }, message: { owner, spender, value: BigInt(l.data === '0x' ? 0 : l.data).toString(), nonce: '0', deadline: '0' } };
      return { id, category: 'sig.permit(EIP-2612)', provenance: 'reconstructed-unverified', tx: tx.hash, block: Number(tx.blockNumber), account: owner, counterparty: spender, request: { method: 'eth_signTypedData_v4', params: [owner, JSON.stringify(td)] }, note: 'from the Approval event (permit submitted via another contract)' };
    }
  }
  return null;
}

const pad = (a: string) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
/**
 * Many PTXPhish hashes are the drain (transferFrom / safeTransferFrom / Permit2 transferFrom sent by the attacker), not
 * the victim's request. Find the grant the drain used: the latest Approval / ApprovalForAll(owner, spender) on that token,
 * or Permit2 Permit(owner, token, spender), in the 30k blocks before the drain (Routescan log search), and
 * rebuild that tx (the victim's approve, or the permit they signed).
 */
async function priorGrant(tx: any, id: string): Promise<Req | null> {
  const input = (tx.input as Hex).toLowerCase();
  const sel = input.slice(0, 10);
  const word = (i: number) => '0x' + input.slice(10 + 64 * i + 24, 10 + 64 * (i + 1));
  let filters: { address: string; topics: (string | null)[] }[] = [];
  let owner = '';
  if (sel === '0x23b872dd' || sel === '0x42842e0e' || sel === '0xb88d4fde') {
    owner = word(0);
    filters = [{ address: tx.to, topics: [APPROVAL, pad(owner), pad(tx.from)] }, { address: tx.to, topics: [AFA, pad(owner), pad(tx.from)] }];
  } else if (sel === '0x36c78516') {
    owner = word(0);
    filters = [{ address: PERMIT2, topics: [P2PERMIT, pad(owner), pad(word(3)), pad(tx.from)] }, { address: word(3), topics: [APPROVAL, pad(owner), pad(PERMIT2)] }];
  } else if (sel === '0x0d58b1db') {
    owner = word(2);
    filters = [{ address: PERMIT2, topics: [P2PERMIT, pad(owner), pad(word(5)), pad(tx.from)] }];
  }
  if (!filters.length) return null;
  const end = Number(tx.blockNumber);
  for (const f of filters) {
    // Routescan log search (free tier allows the whole 30k-block range in one query; public RPCs cap getLogs ranges).
    const q: Record<string, string | number> = { module: 'logs', action: 'getLogs', fromBlock: Math.max(0, end - 30_000), toBlock: end, address: f.address, page: 1, offset: 50 };
    f.topics.forEach((t, i) => t && (q[`topic${i}`] = t));
    for (let i = 0; i + 1 < f.topics.length; i++) q[`topic${i}_${i + 1}_opr`] = 'and';
    const logs = await scan(q).catch(() => []);
    for (const l of [...logs].reverse()) {
      const ptx = await rpc('eth_getTransactionByHash', [l.transactionHash]);
      if (!ptx) continue;
      const spender = '0x' + l.topics[f.topics[0] === P2PERMIT ? 3 : 2].slice(26);
      const r = (await reconstruct(ptx, owner, spender, id).catch(() => null)) ?? (await fromReceipt(ptx, id));
      if (r && r.category !== 'tx.other') return { ...r, note: [r.note, `grant tx ${ptx.hash.slice(0, 12)} found before the drain ${tx.hash.slice(0, 12)} (the PTXPhish hash)`].filter(Boolean).join('; ') };
    }
  }
  return null;
}

async function main() {
  const cols = readXlsx();
  const rows: (Req & { label: string; malicious: boolean })[] = [];
  const skipped: Record<string, Record<string, number>> = {};
  const sizes: Record<string, number> = {};
  for (const [col, { label, malicious }] of Object.entries(COLS)) {
    const all = [...new Set(cols[col] ?? [])];
    sizes[label] = all.length;
    const sample = shuffle(all, 7).slice(0, PER);
    let n = 0;
    for (const h of sample) {
      const tx = await rpc('eth_getTransactionByHash', [h]);
      const skip = (why: string) => ((skipped[label] ??= {})[why] = (skipped[label]![why] ?? 0) + 1);
      if (!tx) {
        skip('tx not found on mainnet');
        continue;
      }
      const id = `ptx:${col}:${h.slice(0, 12)}`;
      // The victim sent the tx itself (approve, setApprovalForAll, bulk transfer, upgrade, payable call, benign).
      const victimSent = !['Permit', 'Free buy order'].includes(label) && !label.startsWith('Address poisoning');
      let r: Req | null = null;
      try {
        r = victimSent ? await reconstruct(tx, tx.from, tx.to ?? '0x0000000000000000000000000000000000000000', id) : null;
        // The hash is the attacker's drain: classify the victim's earlier grant instead (or skip if none is found).
        const drain = ['0x23b872dd', '0x42842e0e', '0xb88d4fde', '0x36c78516', '0x0d58b1db'].includes((tx.input as string).slice(0, 10));
        if (drain && ['Approve', 'SetApproveForAll', 'Permit'].includes(label)) r = await priorGrant(tx, id);
        else if (label === 'Permit') r = (await reconstruct(tx, '0x0000000000000000000000000000000000000001', tx.from, id)) ?? (await fromReceipt(tx, id));
        if (!r && drain) {
          skip('drain tx; victim grant not found within 30k blocks');
          continue;
        }
      } catch (e) {
        skip(`reconstruct error: ${(e as Error).message.split('\n')[0]!.slice(0, 80)}`);
        continue;
      }
      if (!r) {
        skip(label === 'Free buy order' ? 'signed marketplace order (not rebuilt; attacker-sent fill)' : label.startsWith('Address poisoning') ? 'attacker-sent; no user request to classify' : `not reconstructable (${(tx.input as Hex).slice(0, 10)})`);
        continue;
      }
      if (r.counterparty === undefined || r.counterparty === null) r.counterparty = tx.to;
      rows.push({ ...r, label, malicious });
      n++;
    }
    console.log(`${label}: ${n}/${sample.length} of ${all.length}`);
  }
  writeJson('b1-ptxphish-requests.json', { source: { dataset: URL_, paper: 'Chen et al., NDSS 2025', perColumn: PER, seed: 7, columnSizes: sizes }, skipped, requests: rows });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
