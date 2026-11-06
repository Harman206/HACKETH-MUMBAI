// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { connect, discoverWallets, ensureChain, senderFrom, WrongChainError, type Eip1193 } from '../src/wallet';

const ACC = '0x1111111111111111111111111111111111111111';

function provider(over: Record<string, (params?: unknown) => unknown> = {}): Eip1193 & { request: ReturnType<typeof vi.fn> } {
  let chain = '0xaa36a7';
  const handlers: Record<string, (params?: unknown) => unknown> = {
    eth_requestAccounts: () => [ACC],
    eth_chainId: () => chain,
    wallet_switchEthereumChain: (p) => { chain = (p as [{ chainId: string }])[0].chainId; return null; },
    eth_estimateGas: () => '0x186a0',
    eth_sendTransaction: () => '0xabc',
    ...over,
  };
  return { request: vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
    const h = handlers[method];
    if (!h) throw new Error(`unexpected ${method}`);
    return h(params);
  }) } as never;
}

afterEach(() => { delete (window as { ethereum?: unknown }).ethereum; });

describe('wallet', () => {
  test('discoverWallets collects EIP-6963 announcements', async () => {
    const p = provider();
    window.addEventListener('eip6963:requestProvider', () => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name: 'Rabby', rdns: 'io.rabby', uuid: '1', icon: 'data:,' }, provider: p } }));
    }, { once: true });
    const ws = await discoverWallets(20);
    expect(ws.map((w) => w.info.name)).toEqual(['Rabby']);
  });

  test('discoverWallets falls back to window.ethereum', async () => {
    (window as { ethereum?: unknown }).ethereum = provider();
    const ws = await discoverWallets(20);
    expect(ws).toHaveLength(1);
    expect(ws[0]!.info.rdns).toBe('injected');
  });

  test('connect returns account and chain', async () => {
    expect(await connect(provider())).toEqual({ account: ACC, chainId: 11155111 });
  });

  test('ensureChain switches when needed', async () => {
    const p = provider();
    await ensureChain(p, 1);
    expect(p.request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
  });

  test('ensureChain throws WrongChainError when the switch is refused', async () => {
    const p = provider({ wallet_switchEthereumChain: () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); } });
    await expect(ensureChain(p, 1)).rejects.toBeInstanceOf(WrongChainError);
  });

  test('ensureChain adds Sepolia when the wallet does not know it (4902), then checks again', async () => {
    let chain = '0x1';
    let known = false;
    const p = provider({
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => { throw Object.assign(new Error('Unrecognized chain ID "0xaa36a7".'), { code: 4902 }); },
      wallet_addEthereumChain: (params) => { known = true; chain = (params as [{ chainId: string }])[0].chainId; return null; },
    });
    await ensureChain(p, 11155111);
    expect(known).toBe(true);
    const add = p.request.mock.calls.find((c) => (c[0] as { method: string }).method === 'wallet_addEthereumChain')![0] as { params: [Record<string, unknown>] };
    expect(add.params[0]).toMatchObject({ chainId: '0xaa36a7', chainName: 'Sepolia', nativeCurrency: { symbol: 'ETH', decimals: 18 }, blockExplorerUrls: ['https://sepolia.etherscan.io'] });
    expect((add.params[0].rpcUrls as string[]).length).toBeGreaterThan(0);
  });

  test('ensureChain: MetaMask mobile wraps 4902 inside data.originalError', async () => {
    let chain = '0x1';
    const p = provider({
      eth_chainId: () => chain,
      wallet_switchEthereumChain: () => { throw Object.assign(new Error('Internal'), { code: -32603, data: { originalError: { code: 4902 } } }); },
      wallet_addEthereumChain: () => { chain = '0xaa36a7'; return null; },
    });
    await expect(ensureChain(p, 11155111)).resolves.toBeUndefined();
  });

  test('ensureChain: a refused add → WrongChainError with network names', async () => {
    const p = provider({
      eth_chainId: () => '0x1',
      wallet_switchEthereumChain: () => { throw Object.assign(new Error('Unrecognized chain'), { code: 4902 }); },
      wallet_addEthereumChain: () => { throw Object.assign(new Error('User rejected'), { code: 4001 }); },
    });
    await expect(ensureChain(p, 11155111)).rejects.toThrow('Switch your wallet to Sepolia (it is on Ethereum mainnet).');
  });

  test('senderFrom only estimates and sends (never typed-data signing), with 25% gas headroom', async () => {
    const p = provider();
    const s = senderFrom(p, ACC);
    await s.sendTransaction({ chainId: 11155111, from: ACC, to: ACC, data: '0x1234', value: 0n });
    const methods = p.request.mock.calls.map((c) => (c[0] as { method: string }).method);
    expect(methods.filter((m) => m !== 'eth_chainId')).toEqual(['eth_estimateGas', 'eth_sendTransaction']);
    expect(methods.some((m) => /sign/i.test(m))).toBe(false);
    // 0x186a0 = 100000 → 125000 = 0x1e848
    expect(p.request).toHaveBeenCalledWith({ method: 'eth_sendTransaction', params: [{ from: ACC, to: ACC, data: '0x1234', value: '0x0', chainId: '0xaa36a7', gas: '0x1e848' }] });
  });

  test('senderFrom surfaces a failing wallet estimate as a plain error and does not send', async () => {
    const p = provider({ eth_estimateGas: () => { throw new Error('execution reverted'); } });
    await expect(senderFrom(p, ACC).sendTransaction({ chainId: 11155111, from: ACC, to: ACC, data: '0x', value: 0n })).rejects.toThrow(/would fail/);
    expect(p.request.mock.calls.map((c) => (c[0] as { method: string }).method)).not.toContain('eth_sendTransaction');
  });

  test('senderFrom refuses a tx for another account or chain', async () => {
    const s = senderFrom(provider(), ACC);
    await expect(s.sendTransaction({ chainId: 11155111, from: '0x2222222222222222222222222222222222222222', to: ACC, data: '0x', value: 0n })).rejects.toThrow(/connected account/);
    await expect(s.sendTransaction({ chainId: 1, from: ACC, to: ACC, data: '0x', value: 0n })).rejects.toBeInstanceOf(WrongChainError);
  });
});
