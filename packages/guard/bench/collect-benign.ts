/**
 * B1 negative set: real, recent mainnet requests made by ordinary users of major dapps.
 *   - ERC-20 approvals by the token owner to well-known spenders (Permit2, 1inch v6, 0x AllowanceHolder, CoW relayer,
 *     Aave v3 Pool, Uniswap v3 NPM / SwapRouter02, Lido withdrawal queue) and ApprovalForAll to the OpenSea conduit
 *   - plain dapp calls sent by users (Universal Router, 1inch, Aave Pool, v3 NPM, Seaport 1.6, Lido submit)
 *   - Permit2 PermitSingle/PermitBatch signatures for the Universal Router, rebuilt from execute() and signature-checked
 *   ../../node_modules/.bin/tsx bench/collect-benign.ts
 */
import { getAddress, keccak256, toBytes } from 'viem';
import { PERMIT2, reconstruct, urEmbeddedPermit, type Req } from './reconstruct';
import { addrTopic, rpc, scan, topicAddr, writeJson } from './lib';

const SPENDERS: Record<string, string> = {
  'Permit2': PERMIT2,
  '1inch AggregationRouterV6': '0x111111125421cA6dc452d289314280a0f8842A65',
  '0x AllowanceHolder': '0x0000000000001fF3684f28c67538d4D072C22734',
  'CoW GPv2VaultRelayer': '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
  'Aave v3 Pool': '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  'Uniswap v3 NPM': '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  'Uniswap SwapRouter02': '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  'Lido WithdrawalQueue': '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1',
};
const OPERATORS: Record<string, string> = { 'OpenSea conduit': '0x1E0049783F008A0085193E00003D00cd54003c71' };
const TARGETS: Record<string, string> = {
  'Uniswap Universal Router 2.0': '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
  '1inch AggregationRouterV6': '0x111111125421cA6dc452d289314280a0f8842A65',
  'Aave v3 Pool': '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  'Uniswap v3 NPM': '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  'Seaport 1.6': '0x0000000000000068F116a894984e2DB1123eB395',
  'Lido stETH': '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
};
const PER = 12;
const T = {
  approval: keccak256(toBytes('Approval(address,address,uint256)')),
  approvalForAll: keccak256(toBytes('ApprovalForAll(address,address,bool)')),
  p2permit: keccak256(toBytes('Permit(address,address,address,uint160,uint48,uint48)')),
};

async function main() {
  const head = Number(BigInt(await rpc<string>('eth_blockNumber', [], false)));
  const from = head - 20_000; // ≈ 2.8 days
  const reqs: Req[] = [];
  const seen = new Set<string>();
  const add = (r: Req | null, label: string) => {
    if (!r || seen.has(r.tx + r.category)) return false;
    seen.add(r.tx + r.category);
    reqs.push({ ...r, note: label });
    return true;
  };
  const fromLogs = async (label: string, topic0: string, who: string, idx: 2 | 3, address?: string) => {
    const logs = await scan({ module: 'logs', action: 'getLogs', fromBlock: from, toBlock: 'latest', topic0, [`topic${idx}`]: topicAddr(who), [`topic0_${idx}_opr`]: 'and', page: 1, offset: 60, ...(address ? { address } : {}) });
    let n = 0;
    for (const l of logs) {
      if (n >= PER) break;
      const tx = await rpc('eth_getTransactionByHash', [l.transactionHash]);
      if (!tx) continue;
      const r = idx === 3 ? await urEmbeddedPermit(tx, `benign:${label}`) : await reconstruct(tx, addrTopic(l.topics[1]), who, `benign:${label}`);
      if (r && r.provenance === 'real' && !r.category.startsWith('tx.approve') && !r.category.startsWith('tx.setApprovalForAll') && !r.category.startsWith('tx.increaseAllowance')) continue; // keep the approval itself
      if (add(r, label)) n++;
    }
    console.log(`${label}: ${n}`);
  };
  for (const [label, s] of Object.entries(SPENDERS)) await fromLogs(`approve→${label}`, T.approval, s, 2);
  for (const [label, s] of Object.entries(OPERATORS)) await fromLogs(`setApprovalForAll→${label}`, T.approvalForAll, s, 2);
  await fromLogs('Permit2 permit for Universal Router', T.p2permit, TARGETS['Uniswap Universal Router 2.0']!, 3, PERMIT2);
  for (const [label, t] of Object.entries(TARGETS)) {
    const txs = await scan({ module: 'account', action: 'txlist', address: t, startblock: from, endblock: 99999999, page: 1, offset: 80, sort: 'desc' });
    let n = 0;
    for (const t2 of txs) {
      if (n >= PER) break;
      if (t2.isError !== '0' || t2.to?.toLowerCase() !== t.toLowerCase()) continue;
      const tx = await rpc('eth_getTransactionByHash', [t2.hash]);
      if (!tx) continue;
      const r = await reconstruct(tx, tx.from, t, `benign:call→${label}`);
      if (r) r.category = r.category === 'tx.other' || r.category === 'tx.payable-call' ? `tx.dapp-call${r.category === 'tx.payable-call' ? '(with ETH)' : ''}` : r.category;
      if (add(r ? { ...r, counterparty: getAddress(t) } : null, `call→${label}`)) n++;
    }
    console.log(`call→${label}: ${n}`);
  }
  writeJson('b1-benign-requests.json', { source: { head, fromBlock: from, spenders: SPENDERS, operators: OPERATORS, targets: TARGETS }, requests: reqs });
  console.log(reqs.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
