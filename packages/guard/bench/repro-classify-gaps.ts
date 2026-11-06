/** Minimal repros for the classifyRequest gaps in docs/benchmarks/b1-drainer-requests.md (run: ../../node_modules/.bin/tsx bench/repro-classify-gaps.ts). */
import { encodeFunctionData, parseAbi } from 'viem';
import { classifyRequest } from '../src/index';
const abi = parseAbi(['function approve(address,uint256)', 'function multicall(bytes[])', 'function setApprovalForAll(address,bool)']);
const ATT = '0x000000000000000000000000000000000000dEaD';
const USER = '0x1111111111111111111111111111111111111111';
const ctx = { account: USER as any, chainId: 1, manifests: [] };
const small = encodeFunctionData({ abi, functionName: 'approve', args: [ATT, 5n] });
const mc = encodeFunctionData({ abi, functionName: 'multicall', args: [[small]] });
const send = (data: string, to = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') => classifyRequest({ method: 'eth_sendTransaction', params: [{ from: USER, to, data, value: '0x0' }] }, ctx);
console.log('direct approve 5     :', send(small).verdict, send(small).reasons[0]);
console.log('multicall[approve 5] :', send(mc).verdict, send(mc).reasons[0]);
console.log('approve(ATT, 0) revoke:', send(encodeFunctionData({ abi, functionName: 'approve', args: [ATT, 0n] })).verdict, send(encodeFunctionData({ abi, functionName: 'approve', args: [ATT, 0n] })).reasons[0]);
console.log('setApprovalForAll false:', send(encodeFunctionData({ abi, functionName: 'setApprovalForAll', args: [ATT, false] })).verdict, send(encodeFunctionData({ abi, functionName: 'setApprovalForAll', args: [ATT, false] })).reasons[0]);
const big = encodeFunctionData({ abi, functionName: 'approve', args: [ATT, 2n ** 256n - 1n] });
const mc2 = encodeFunctionData({ abi, functionName: 'multicall', args: [[big]] });
console.log('multicall[approve max]:', send(mc2).verdict, send(mc2).reasons[0]);
