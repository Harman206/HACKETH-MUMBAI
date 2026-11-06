import { concatHex, encodeFunctionData, encodePacked, hashTypedData, keccak256, parseAbi, size, stringToHex, zeroAddress, type Hex } from 'viem';
import type { Address } from '@copeybara/core';

/** Safe MultiSendCallOnly v1.4.1 (same address on every chain; checked on Sepolia). Cannot delegatecall onwards. */
export const MULTISEND_CALL_ONLY: Address = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2';

export interface SafeCall {
  to: Address;
  data: Hex;
  /** What this call does, in words (printed and put in the batch description). */
  label: string;
}

/** Safe{Wallet} Transaction Builder batch file (Apps → Transaction Builder → drag and drop). */
export interface TxBuilderBatch {
  version: '1.0';
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: string;
    createdFromOwnerAddress: string;
    checksum?: string;
  };
  transactions: { to: string; value: string; data: string; contractMethod: null; contractInputsValues: null }[];
}

const replacer = (_: string, v: unknown) => (v === undefined ? null : v);
/** Transaction Builder's own serialisation (sorted keys, see safe-react-apps tx-builder lib/checksum.ts). */
function serialize(json: unknown): string {
  if (Array.isArray(json)) return `[${json.map(serialize).join(',')}]`;
  if (typeof json === 'object' && json !== null) {
    const keys = Object.keys(json).sort();
    let acc = `{${JSON.stringify(keys, replacer)}`;
    for (const k of keys) acc += `${serialize((json as Record<string, unknown>)[k])},`;
    return `${acc}}`;
  }
  return JSON.stringify(json, replacer);
}

export function txBuilderBatch(o: { chainId: number; safe: Address; name: string; calls: SafeCall[]; createdAt: number }): TxBuilderBatch {
  const b: TxBuilderBatch = {
    version: '1.0',
    chainId: String(o.chainId),
    createdAt: o.createdAt,
    meta: {
      name: o.name,
      description: o.calls.map((c, i) => `${i + 1}. ${c.label}`).join('\n'),
      txBuilderVersion: '1.16.5',
      createdFromSafeAddress: o.safe,
      createdFromOwnerAddress: '',
    },
    transactions: o.calls.map((c) => ({ to: c.to, value: '0', data: c.data, contractMethod: null, contractInputsValues: null })),
  };
  b.meta.checksum = keccak256(stringToHex(serialize({ ...b, meta: { ...b.meta, name: null } })));
  return b;
}

const multiSendAbi = parseAbi(['function multiSend(bytes transactions)']);

/** One Safe transaction (DELEGATECALL into MultiSendCallOnly) that runs every call in order, value 0 each. */
export function multiSend(calls: SafeCall[], multiSendAddress: Address = MULTISEND_CALL_ONLY): { to: Address; value: 0n; data: Hex; operation: 1 } {
  const packed = concatHex(calls.map((c) => encodePacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, c.to, 0n, BigInt(size(c.data)), c.data])));
  return { to: multiSendAddress, value: 0n, data: encodeFunctionData({ abi: multiSendAbi, functionName: 'multiSend', args: [packed] }), operation: 1 };
}

export interface SafeTx {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  nonce: bigint;
}

/** EIP-712 SafeTx hash (Safe ≥ 1.3) — what each owner signs, on their own device. */
export function safeTxHash(safe: Address, chainId: number, t: SafeTx): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    message: { ...t, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: zeroAddress, refundReceiver: zeroAddress },
  });
}

/**
 * Body for POST {txService}/api/v1/safes/{safe}/multisig-transactions/. `signature` comes from an owner's wallet
 * (hardware wallet, Safe app, `cast wallet sign`); the CLI never sees a key.
 */
export function safeApiProposal(safe: Address, chainId: number, t: SafeTx, sender: Address, signature: Hex) {
  return {
    to: t.to,
    value: t.value.toString(),
    data: t.data,
    operation: t.operation,
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: t.nonce.toString(),
    contractTransactionHash: safeTxHash(safe, chainId, t),
    sender,
    signature,
    origin: 'copeybara protocol-cli',
  };
}
