import { describe, expect, test } from 'vitest';
import { encodeManifest, ManifestError, parseManifest, SEL, type Manifest } from '../src';

const NPM = '0x1238536071E1c677A632429e3655c799b22cDA52';
const POOL = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7';
const LP = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490';

const m: Manifest = {
  v: 1,
  chains: {
    '11155111': {
      'uniswap-v3': { positionManager: { address: NPM, selectors: [SEL.multicall, SEL.collect] } },
    },
    '1': {
      'curve-3pool': {
        pool: { address: POOL, selectors: [SEL.curveRemoveLiquidity] },
        lpToken: { address: LP, selectors: [] },
      },
    },
  },
};

describe('manifest codec', () => {
  test('round trips', () => {
    expect(parseManifest(encodeManifest(m))).toEqual(m);
  });

  test('encoding is stable regardless of key insertion order', () => {
    const reordered: Manifest = { v: 1, chains: { '1': m.chains['1']!, '11155111': m.chains['11155111']! } };
    expect(encodeManifest(reordered)).toBe(encodeManifest(m));
  });

  test('checksums addresses on parse', () => {
    const lower = encodeManifest(m).replace(NPM, NPM.toLowerCase());
    expect(parseManifest(lower).chains['11155111']!['uniswap-v3']!.positionManager!.address).toBe(NPM);
  });

  const bad: [string, string][] = [
    ['', 'empty'],
    ['{', 'not valid JSON'],
    ['{"v":2,"c":{}}', 'unsupported version'],
    ['{"v":1,"c":{"1":{"curve-3pool":{"pool":{"a":"0x1234","s":[]}}}}}', 'address'],
    [`{"v":1,"c":{"1":{"curve-3pool":{"pool":{"a":"${POOL}","s":["0xabcdef"]}}}}}`, 'selector'],
    [`{"v":1,"c":{"1":{"sushiswap":{"pool":{"a":"${POOL}","s":[]}}}}}`, 'protocol'],
    [`{"v":1,"c":{"one":{}}}`, 'chain'],
  ];
  test.each(bad)('rejects %j with a message about %s', (text, phrase) => {
    expect(() => parseManifest(text)).toThrow(ManifestError);
    expect(() => parseManifest(text)).toThrow(new RegExp(phrase));
  });
});
