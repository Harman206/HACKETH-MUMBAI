/**
 * B1 positive set: real wallet requests whose spender/receiver is on ScamSniffer's public drainer/scam address list
 * (github.com/scamsniffer/scam-database, blacklist/address.json). For a seeded random sample of the list we search the full
 * mainnet history (Routescan) for: ERC-20/721 Approval and ApprovalForAll to the address, Permit2 Permit events naming it as
 * spender, ERC-20 Transfers into it, and ETH-carrying txs into it; then rebuild each request (reconstruct.ts).
 *   ../../node_modules/.bin/tsx bench/collect-drainers.ts [sampleSize=150]
 */
import { keccak256, toBytes } from 'viem';
import { PERMIT2, reconstruct, type Req } from './reconstruct';
import { addrTopic, rpc, scan, shuffle, topicAddr, writeJson } from './lib';

const N = Number(process.argv[2] ?? 150);
const PER = 2; // samples per (address, source)
const T = {
  approval: keccak256(toBytes('Approval(address,address,uint256)')),
  approvalForAll: keccak256(toBytes('ApprovalForAll(address,address,bool)')),
  transfer: keccak256(toBytes('Transfer(address,address,uint256)')),
  p2permit: keccak256(toBytes('Permit(address,address,address,uint160,uint48,uint48)')),
};

async function main() {
  const listUrl = 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json';
  const commit = ((await (await fetch('https://api.github.com/repos/scamsniffer/scam-database/commits?per_page=1&path=blacklist/address.json')).json()) as any[])[0];
  const list = ((await (await fetch(listUrl)).json()) as string[]).map((a) => a.toLowerCase());
  const sample = shuffle([...new Set(list)], 20261107).slice(0, N);
  console.log(`ScamSniffer list: ${list.length} addresses @ ${commit?.sha} (${commit?.commit?.committer?.date}); sampling ${sample.length}`);

  const reqs: Req[] = [];
  const seenTx = new Set<string>();
  const stats = { addresses: sample.length, withAnyHit: 0, logsSeen: 0, skippedNotReconstructable: 0, skippedNotMainnetTx: 0 };
  const skipped: Record<string, number> = {};
  const getTx = (h: string) => rpc('eth_getTransactionByHash', [h]);

  for (const [i, a] of sample.entries()) {
    let hit = false;
    const take = async (hashes: { hash: string; owner: string; erc721?: boolean }[], src: string) => {
      let n = 0;
      for (const { hash, owner, erc721 } of hashes) {
        if (n >= PER) break;
        if (seenTx.has(hash)) continue;
        seenTx.add(hash);
        const tx = await getTx(hash);
        if (!tx) {
          stats.skippedNotMainnetTx++;
          continue;
        }
        const r = await reconstruct(tx, owner, a, `drainer:${src}`).catch(() => null);
        if (!r) {
          stats.skippedNotReconstructable++;
          const k = `${src}:${(tx as any).input.slice(0, 10)}`;
          skipped[k] = (skipped[k] ?? 0) + 1;
          continue;
        }
        if (erc721) r.category += '(ERC721)';
        reqs.push({ ...r, note: [r.note, `ScamSniffer-listed ${a}`].filter(Boolean).join('; ') });
        n++;
        hit = true;
      }
    };
    const logs = (topic0: string, idx: 2 | 3, address?: string) =>
      scan({ module: 'logs', action: 'getLogs', fromBlock: 0, toBlock: 'latest', topic0, [`topic${idx}`]: topicAddr(a), [`topic0_${idx}_opr`]: 'and', page: 1, offset: 20, ...(address ? { address } : {}) });

    const ap = await logs(T.approval, 2);
    const afa = await logs(T.approvalForAll, 2);
    const p2 = await logs(T.p2permit, 3, PERMIT2);
    const tr = await logs(T.transfer, 2);
    const txl = await scan({ module: 'account', action: 'txlist', address: a, startblock: 0, endblock: 99999999, page: 1, offset: 30, sort: 'asc' });
    stats.logsSeen += ap.length + afa.length + p2.length + tr.length;
    const owners = (ls: any[]) => ls.filter((l) => l.topics?.length >= 3).map((l) => ({ hash: l.transactionHash, owner: addrTopic(l.topics[1]), erc721: l.topics.length === 4 && l.topics[0] === T.approval }));
    await take(owners(ap), 'approval');
    await take(owners(afa), 'approvalForAll');
    await take(owners(p2), 'permit2');
    await take(owners(tr.filter((l) => l.topics?.length === 3)), 'transferIn');
    await take(
      txl.filter((t: any) => t.to?.toLowerCase() === a && t.from.toLowerCase() !== a && BigInt(t.value) > 0n && t.isError === '0').map((t: any) => ({ hash: t.hash, owner: t.from })),
      'ethIn',
    );
    if (hit) stats.withAnyHit++;
    if (i % 10 === 9) console.log(`${i + 1}/${sample.length} addresses, ${reqs.length} requests`);
  }
  writeJson('b1-drainer-requests.json', { source: { list: listUrl, commit: commit?.sha, committed: commit?.commit?.committer?.date, listSize: list.length, seed: 20261107 }, stats, skippedBySourceAndSelector: skipped, requests: reqs });
  console.log(stats, reqs.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
