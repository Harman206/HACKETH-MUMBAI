import { describe, expect, test } from 'vitest';
import { humanize } from '../src/errors';

describe('humanize: raw wallet/RPC/ENS errors → plain language + one fix', () => {
  test('insufficient funds → fee explanation; faucet only on Sepolia', () => {
    const raw = 'The wallet could not send the transaction: insufficient funds for gas * price + value';
    expect(humanize(raw, { chainId: 11155111 })).toMatchObject({ fix: 'faucet', text: expect.stringMatching(/enough ETH to pay the network fee.*free/i) });
    const main = humanize(raw, { chainId: 1 });
    expect(main.fix).toBeUndefined();
    expect(main.text).toMatch(/add a little ETH/i);
  });

  test('a declined wallet prompt → nothing happened, try again', () => {
    for (const raw of ['You rejected the transaction in your wallet.', 'User rejected the request.', 'MetaMask Tx Signature: User denied transaction signature.']) {
      expect(humanize(raw)).toMatchObject({ fix: 'retry', text: expect.stringMatching(/declined.*nothing (was sent|happened)/i) });
    }
  });

  test('a request already open in the wallet → open the wallet', () => {
    expect(humanize("Request of type 'wallet_requestPermissions' already pending for origin http://localhost:8000. Please wait.")).toMatchObject({ fix: 'open-wallet' });
  });

  test('wrong network → one-click switch, keeps the network names', () => {
    expect(humanize('Switch your wallet to Sepolia (it is on Ethereum mainnet).')).toEqual({ fix: 'switch-chain', text: 'Switch your wallet to Sepolia (it is on Ethereum mainnet).' });
  });

  test('no wallet: on file:// explain the browser rule; elsewhere point to an install', () => {
    const raw = 'No browser wallet found. Open this file on http://localhost with MetaMask or Rabby installed.';
    expect(humanize(raw, { protocol: 'file:' })).toMatchObject({ fix: 'serve-localhost', text: expect.stringMatching(/opened from disk/i) });
    expect(humanize(raw, { protocol: 'https:' })).toMatchObject({ fix: 'install-wallet' });
  });

  test('too few or disagreeing RPCs → explain why the kit stopped and offer your own RPC', () => {
    expect(humanize('Only 1 of 3 RPC paths answered eth_call; need 2.')).toMatchObject({ fix: 'add-rpc', text: expect.stringMatching(/Only 1 of 3.*needs 2 that agree/i) });
    expect(humanize('RPC paths disagree on eth_call; refusing to continue.')).toMatchObject({ fix: 'add-rpc', text: expect.stringMatching(/different answers.*rather than guess/i) });
    expect(humanize('RPC paths are too far apart in block height (1, 900); refusing to pick one.')).toMatchObject({ fix: 'add-rpc' });
  });

  test('ENS name problems → check the name against the docs', () => {
    for (const raw of ['"foo" is not a full ENS name like protocol.eth.', 'nope.eth is not set up on ENS (no resolver, or the resolver refused the lookup).', 'x.eth has no release record, so this kit cannot be checked against it.']) {
      const h = humanize(raw);
      expect(h.fix).toBe('check-name');
      expect(h.text.startsWith(raw)).toBe(true);
    }
  });

  test('anything else passes through unchanged, with no fix', () => {
    const raw = 'Sends to 0xbad…, not your wallet. Blocked.';
    expect(humanize(raw)).toEqual({ text: raw });
  });
});
