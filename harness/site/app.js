// DemoSwap main bundle (its sha256 can be published as org.blackout.site).
document.getElementById('connect')?.addEventListener('click', async () => {
  const eth = window.ethereum;
  if (!eth) return (document.getElementById('status').textContent = 'No wallet found.');
  const [a] = await eth.request({ method: 'eth_requestAccounts' });
  document.getElementById('status').textContent = `Connected ${a}`;
});
