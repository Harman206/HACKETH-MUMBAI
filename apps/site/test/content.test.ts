import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INCIDENTS, HOW, REPLAY_R1, TRUSTED, NOT_TRUSTED, LIMITS } from '../src/content';

const REPO = join(__dirname, '..', '..', '..');
const evidence = [
  ...readdirSync(join(REPO, 'contracts', 'deployments')).filter((f) => f.startsWith('sepolia') && f.endsWith('.json')).map((f) => readFileSync(join(REPO, 'contracts', 'deployments', f), 'utf8')),
  ...readdirSync(join(REPO, 'replay', 'fixtures')).map((f) => readFileSync(join(REPO, 'replay', 'fixtures', f), 'utf8')),
].join('\n').toLowerCase();

describe('site content', () => {
  test('every incident has a source, or is explicitly tagged unverified', () => {
    for (const i of INCIDENTS) expect(Boolean(i.source) || i.unverified === true, i.name).toBe(true);
  });
  test('every tx hash in the content is backed by deployments or replay fixtures', () => {
    const text = JSON.stringify({ INCIDENTS, HOW, REPLAY_R1 });
    for (const h of text.match(/0x[0-9a-fA-F]{64}/g) ?? []) expect(evidence.includes(h.toLowerCase()), h).toBe(true);
  });
  test('the replay card numbers match the committed replay report', () => {
    const md = readFileSync(join(REPO, 'docs', 'replay', 'R1.md'), 'utf8');
    expect(md).toContain(REPLAY_R1.lostWithout);
    expect(REPLAY_R1.labels).toEqual(['mainnet fork', 'counterfactual']);
  });
  test('how-it-works has the four ideas; trust model and limits are not empty', () => {
    expect(HOW.map((h) => h.title)).toHaveLength(4);
    expect(TRUSTED.length).toBeGreaterThan(2);
    expect(NOT_TRUSTED.length).toBeGreaterThan(2);
    expect(LIMITS.join(' ')).toMatch(/smart-contract exploits/i);
  });
});
