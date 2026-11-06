import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Address, Hex, TxRequest } from '@copeybara/core';
import { USER } from './helpers';

const DIR = join(__dirname, '..', '..', '..', 'replay', 'fixtures');
const NAMES: Record<string, string> = { R1: 'Curve DNS hijack 2022', R2: 'Balancer frontend hijack 2023' };

/** The victims' real approve calldata from replay/fixtures (Task 9.2). */
export const INCIDENT_CORPUS: { name: string; tx: TxRequest }[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { id: string; approveCalldata?: Hex; approveTarget?: Address })
  .filter((fx) => fx.approveCalldata && fx.approveTarget)
  .map((fx) => ({
    name: `${fx.id} approve (${NAMES[fx.id] ?? fx.id})`,
    tx: { chainId: 1, from: USER, to: fx.approveTarget!, data: fx.approveCalldata!, value: 0n },
  }));
