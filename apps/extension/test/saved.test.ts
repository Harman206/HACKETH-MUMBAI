import { describe, expect, test } from 'vitest';
import { blockedReason, savedReason } from '../src/pages/saved';

describe('"Saved by Copey!" reason line', () => {
  test.each([
    [{ verdict: 'risky', method: 'eth_requestAccounts', reasons: ["This site imitates demoswap-blackout.eth but is not its official address (http://demoswap.localhost:8080 from ENS). Don't connect your wallet here."] }, 'You didn’t connect your wallet to a fake demoswap-blackout.eth site.'],
    [{ verdict: 'dangerous', method: 'eth_sendTransaction', reasons: ['This lets 0xbad…0 spend ALL of this token in your wallet, now and later. No protocol you follow publishes that address: this is how wallet drainers work.'] }, 'You stopped a drainer from taking ALL of this token from your wallet.'],
    [{ verdict: 'dangerous', method: 'eth_signTypedData_v4', reasons: ['A Permit2 signature for a spender that is not Uniswap: x. It lets 0xbad spend your tokens without another transaction.'] }, 'You refused a Permit2 signature that would let a drainer spend your tokens.'],
    [{ verdict: 'dangerous', method: 'eth_sign', reasons: ['eth_sign signs a raw hash.'] }, 'You refused a blind signature that could authorize almost anything.'],
    [{ verdict: 'risky', method: 'eth_sendTransaction', reasons: ['This creates a new contract.'] }, 'You cancelled a risky request before your wallet ever saw it.'],
  ] as const)('%#', (c, line) => {
    expect(savedReason({ ...c, reasons: [...c.reasons] })).toBe(line);
  });
  test('blocked pages', () => {
    expect(blockedReason('mismatch', 'x.eth')).toMatch(/hijacked x\.eth page/);
    expect(blockedReason('blocklist', 'x.eth')).toMatch(/known fake x\.eth site/);
  });
});
