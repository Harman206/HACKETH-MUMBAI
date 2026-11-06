import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { erc4626Kind, type Address } from '@copeybara/core';
import type { CopeybaraConfig, LoadedConfig } from '../src';

export const SAFE: Address = '0x3ae03951044Ced07F7fa12072CfE7F95827A057F';
export const RESOLVER: Address = '0x642cD108b4EA8cb1e7617213533FfE1AcE8BDE82';
export const WEB: Address = '0xA2f199fEd2Fecf201422C71e1E53C76Fd6f4d182';
export const WATCHER: Address = '0xeBbcD4fC4265dbb7Fc7b2df00f1fD7B89FA1EfF8';
export const VAULT: Address = '0x5555555555555555555555555555555555555555';

export const VAULT_ABI = [
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];

export function loaded(over: Partial<CopeybaraConfig> = {}): LoadedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'copeybara-cli-'));
  writeFileSync(join(dir, 'Vault.json'), JSON.stringify({ abi: VAULT_ABI }));
  const cfg: CopeybaraConfig = {
    name: 'demoswap-blackout.eth',
    safe: SAFE,
    resolver: RESOLVER,
    websiteKey: WEB,
    watcher: { key: WATCHER },
    kit: { file: 'kit.html', version: 1 },
    chains: { '11155111': { spec: { vault: { address: VAULT, functions: ['redeem(uint256,address,address)'], abi: 'Vault.json' } } } },
    exits: { vault: erc4626Kind('Demo vault') },
    ...over,
  };
  return { cfg, dir };
}
