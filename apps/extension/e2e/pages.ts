/** Plain test pages served from a non-protocol origin: an ordinary dapp and hostile pages. */
type Tx = { to: string; data: string; value: string };

const shell = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>test</title></head><body>${body}</body></html>`;

const askApprove = (tx: Tx) => `
async function approve(eth) {
  const out = document.getElementById('result');
  try {
    const [from] = await eth.request({ method: 'eth_requestAccounts' });
    await eth.request({ method: 'eth_sendTransaction', params: [{ ...${JSON.stringify(tx)}, from }] });
    out.textContent = 'sent';
  } catch (e) {
    out.textContent = 'error ' + (e && e.code);
  }
}`;

export const PAGES: Record<string, (tx: Tx) => string> = {
  /** An ordinary dapp (not a followed protocol) that asks for an unlimited approval to a drainer. */
  'dapp.html': (tx) =>
    shell(`<h1>Free rewards</h1><button id="go">Claim</button><p id="result"></p>
<script>${askApprove(tx)}
document.getElementById('go').onclick = () => approve(window.ethereum);
if (location.search.includes('auto')) setTimeout(() => approve(window.ethereum), 300);</script>`),

  /** Hostile page: forges extension answers, floods malformed messages, probes extension internals. */
  'hostile.html': (tx) =>
    shell(`<p id="result"></p><p id="probe"></p>
<script>
const early = window.ethereum; // a reference grabbed by the page itself
${askApprove(tx)}
const probe = {};
probe.runtime = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.sendMessage);
probe.storage = typeof chrome !== 'undefined' && !!chrome.storage;
// forged "allow" answers for any id, and malformed requests
for (let i = 0; i < 50; i++) window.postMessage({ tag: 'copeybara:res', id: 'r' + i, decision: 'allow' }, '*');
for (let i = 0; i < 50; i++) window.postMessage({ tag: 'copeybara:req', id: 42, method: null }, '*');
window.postMessage({ tag: 'copeybara:kit-address', address: 'not-an-address' }, '*');
document.getElementById('probe').textContent = JSON.stringify(probe);
document.getElementById('probe').dataset.done = '1';
window.go = () => approve(early);
</script>`),

  /** A page that floods eth_sign requests (6 in a row). */
  'flood.html': () =>
    shell(`<p id="result"></p><script>
window.flood = async () => {
  const [from] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const rs = await Promise.allSettled(Array.from({ length: 6 }, () => window.ethereum.request({ method: 'eth_sign', params: [from, '0x' + 'ab'.repeat(32)] })));
  document.getElementById('result').textContent = rs.map((r) => r.status === 'rejected' ? (r.reason && r.reason.code) : 'ok').join(',');
};</script>`),

  /** A page that embeds the drainer dapp in a cross-origin iframe which asks on load. */
  'frame.html': () => shell(`<iframe id="f" width="600" height="300"></iframe><script>document.getElementById('f').src = location.href.replace('127.0.0.1', 'localhost').replace('frame.html', 'dapp.html?auto');</script>`),
};
