import { describe, expect, test } from 'vitest';
import {
  checkSpecAgainstManifest,
  encodeExitSpec,
  erc4626Kind,
  parseExitSpec,
  parseManifest,
  encodeManifest,
  SpecError,
  specExitSelector,
  validateExitSpec,
  type ExitSpec,
  type Manifest,
} from '../src';

const VAULT = '0x1111111111111111111111111111111111111111';
const spec: ExitSpec = { v: 1, kinds: { vault: erc4626Kind('Demo vault') } };
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(spec));

describe('exit spec codec', () => {
  test('round trips with a stable encoding', () => {
    const text = encodeExitSpec(spec);
    expect(parseExitSpec(text)).toEqual(spec);
    expect(encodeExitSpec(parseExitSpec(text)!)).toBe(text);
  });

  test('empty record means no spec', () => {
    expect(parseExitSpec('')).toBeNull();
    expect(parseExitSpec('  ')).toBeNull();
  });

  const mutate = (f: (s: Record<string, any>) => void) => {
    const s = clone();
    f(s);
    return s;
  };
  const vault = (s: Record<string, any>) => s.kinds.vault;

  const bad: [string, Record<string, any>, RegExp][] = [
    ['unknown top-level field', mutate((s) => (s.extra = 1)), /unknown field "extra"/],
    ['unknown kind field', mutate((s) => (vault(s).hooks = [])), /unknown field "hooks"/],
    ['unknown exit field', mutate((s) => (vault(s).exit.value = '1')), /unknown field "value"/],
    ['wrong version', mutate((s) => (s.v = 2)), /unsupported version/],
    ['bytes argument (signatures, calldata)', mutate((s) => (vault(s).exit.fn = 'redeem(uint256,address,bytes)')), /not supported/],
    ['tuple argument', mutate((s) => (vault(s).exit.fn = 'redeem((uint256,address))')), /canonical signature/],
    ['approve as exit', mutate((s) => { vault(s).exit.fn = 'approve(address,uint256)'; vault(s).exit.args = ['$account', '$amount']; vault(s).exit.recipient = [0]; vault(s).exit.self = []; }), /approval, permit or transfer/],
    ['transfer as exit', mutate((s) => { vault(s).exit.fn = 'transfer(address,uint256)'; vault(s).exit.args = ['$account', '$amount']; vault(s).exit.recipient = [0]; vault(s).exit.self = []; }), /approval, permit or transfer/],
    ['array argument', mutate((s) => { vault(s).exit.fn = 'multicall(bytes[])'; }), /canonical signature/],
    ['kit selector collision (Aave withdraw)', mutate((s) => { vault(s).exit.fn = 'withdraw(address,uint256,address)'; vault(s).exit.args = ['$account', '$amount', '$account']; vault(s).exit.recipient = [2]; vault(s).exit.self = [0]; }), /collides/],
    ['address arg not pinned', mutate((s) => (vault(s).exit.self = [])), /address argument 2 must be listed/],
    ['address arg set to a literal', mutate((s) => (vault(s).exit.args[1] = '0')), /must be \$account/],
    ['recipient index on a uint', mutate((s) => (vault(s).exit.recipient = [0])), /not an address argument/],
    ['recipient out of range', mutate((s) => (vault(s).exit.recipient = [7])), /not an address argument/],
    ['recipient and self overlap', mutate((s) => (vault(s).exit.self = [1, 2])), /both recipient and self/],
    ['no recipient and not pays-caller', mutate((s) => { vault(s).exit.recipient = []; vault(s).exit.self = [1, 2]; }), /must pay a recipient/],
    ['unknown placeholder', mutate((s) => (vault(s).exit.args[0] = '$balance')), /unknown placeholder/],
    ['$min on a missing return', mutate((s) => (vault(s).exit.args[0] = '$min:3')), /unsigned return value/],
    ['payout to a missing token', mutate((s) => (vault(s).exit.payout = [{ token: 1, ret: 0 }])), /not a token index/],
    ['empty payout', mutate((s) => (vault(s).exit.payout = [])), /at least one/],
    ['wrong arg count', mutate((s) => (vault(s).exit.args = ['$amount'])), /takes 3 argument/],
    ['unknown discovery mode', mutate((s) => (vault(s).discover = { mode: 'magic' })), /unknown discovery mode/],
    ['log scan without bound', mutate((s) => (vault(s).discover = { mode: 'logs', event: 'Transfer(address,address,uint256)', toTopic: 2, idTopic: 3, owner: { fn: 'ownerOf(uint256)', args: ['$id'] }, maxBlocks: 10_000_000 })), /maxBlocks/],
    ['bad kind name', mutate((s) => { s.kinds['bad name'] = vault(s); }), /not a valid kind name/],
    ['no tokens', mutate((s) => (vault(s).tokens = [])), /1–4 view calls/],
  ];
  test.each(bad)('rejects: %s', (_, raw, msg) => {
    expect(() => validateExitSpec(raw)).toThrow(SpecError);
    expect(() => validateExitSpec(raw)).toThrow(msg);
  });

  test('not JSON is a SpecError', () => {
    expect(() => parseExitSpec('{')).toThrow(SpecError);
  });

  test('logs discovery with a bound parses', () => {
    const s = mutate((x) => (vault(x).discover = { mode: 'logs', event: 'Transfer(address,address,uint256)', toTopic: 2, idTopic: 3, owner: { fn: 'ownerOf(uint256)', args: ['$id'] }, maxBlocks: 50_000 }));
    expect(validateExitSpec(s).kinds.vault!.discover.mode).toBe('logs');
  });
});

describe('spec ↔ manifest cross-check', () => {
  const manifest = (selectors: string[]): Manifest =>
    parseManifest(encodeManifest({ v: 1, chains: { '11155111': { spec: { vault: { address: VAULT, selectors: selectors as `0x${string}`[] } } } } }));

  test('consistent when the role allows exactly the spec exit selector', () => {
    expect(checkSpecAgainstManifest(spec, manifest([specExitSelector(spec.kinds.vault!)]))).toEqual([]);
  });
  test('flags a missing kind, an extra selector, and a missing spec', () => {
    expect(checkSpecAgainstManifest({ v: 1, kinds: { other: erc4626Kind('x') } }, manifest([specExitSelector(spec.kinds.vault!)]))[0]).toMatch(/no kind "vault"/);
    expect(checkSpecAgainstManifest(spec, manifest([specExitSelector(spec.kinds.vault!), '0x095ea7b3']))[0]).toMatch(/exactly/);
    expect(checkSpecAgainstManifest(null, manifest([specExitSelector(spec.kinds.vault!)]))[0]).toMatch(/no kind/);
  });
  test('spec is a known manifest protocol now (no longer skipped as unknown)', () => {
    const m = manifest([specExitSelector(spec.kinds.vault!)]);
    expect(m.unknown).toBeUndefined();
    expect(m.chains['11155111']!.spec!.vault!.address).toBe(VAULT);
  });
});
