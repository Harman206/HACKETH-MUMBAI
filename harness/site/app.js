// DemoSwap main bundle (its sha256 can be published as org.copeybara.site).
// Plain JS, no build step: reads the connected wallet's Uniswap v3 positions on Sepolia straight from the
// position manager (eth_call through the wallet) and asks for ordinary requests on Deposit / Withdraw.
(function () {
  var SEPOLIA = '0xaa36a7';
  var NPM = '0x1238536071E1c677A632429e3655c799b22cDA52'; // Uniswap v3 NonfungiblePositionManager (Sepolia)
  var TOKENS = {
    '0x62715d2762949ab8fb124eb01f78898feb8a596a': 'DETH',
    '0x79c2d3b20e12c95243c2febae903999912fc6eca': 'DUSD',
  };
  var DUSD = '0x79c2D3B20e12c95243C2FeBaE903999912fc6EcA';
  var account = null;

  function $(id) { return document.getElementById(id); }
  function eth() { return window.ethereum; }
  function pad(v) { return (typeof v === 'bigint' ? v.toString(16) : String(v).replace(/^0x/, '')).padStart(64, '0'); }
  function word(hex, i) { return BigInt('0x' + (hex.slice(2 + 64 * i, 2 + 64 * (i + 1)) || '0')); }
  function int24(w) { return Number(w > (1n << 255n) ? w - (1n << 256n) : w); }
  function addr(w) { return '0x' + w.toString(16).padStart(40, '0'); }
  function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
  function sym(a) { return TOKENS[a.toLowerCase()] || short(a); }
  function units(v, dec) {
    var s = v.toString().padStart(dec + 1, '0');
    var whole = s.slice(0, s.length - dec), frac = s.slice(s.length - dec, s.length - dec + 4).replace(/0+$/, '');
    return Number(whole).toLocaleString('en-US') + (frac ? '.' + frac : '');
  }
  function call(to, data) { return eth().request({ method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }); }
  function status(t) { $('status').textContent = t; }

  async function connect() {
    if (!eth()) return status('No wallet found. Install MetaMask to use DemoSwap.');
    var accounts = await eth().request({ method: 'eth_requestAccounts' });
    account = accounts[0];
    var chain = await eth().request({ method: 'eth_chainId' }).catch(function () { return SEPOLIA; });
    if (chain !== SEPOLIA) {
      await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA }] }).catch(function () {});
    }
    $('connect').textContent = short(account);
    $('acct').textContent = 'Connected ' + short(account);
    await loadPositions();
  }

  async function loadPositions() {
    status('Reading your positions from the Uniswap v3 position manager…');
    $('pos-list').innerHTML = '';
    try {
      var n = Number(word(await call(NPM, '0x70a08231' + pad(account)), 0));
      if (!n) return status('No positions yet. Pick a pool above and deposit to start earning fees.');
      var rows = [];
      for (var i = 0; i < Math.min(n, 8); i++) {
        var id = word(await call(NPM, '0x2f745c59' + pad(account) + pad(BigInt(i))), 0);
        var p = await call(NPM, '0x99fbab88' + pad(id));
        rows.push({
          id: id, token0: addr(word(p, 2)), token1: addr(word(p, 3)), fee: Number(word(p, 4)),
          lower: int24(word(p, 5)), upper: int24(word(p, 6)), liquidity: word(p, 7), owed0: word(p, 10), owed1: word(p, 11),
        });
      }
      status(n + ' position' + (n === 1 ? '' : 's') + ' · read straight from the contracts on Sepolia');
      $('pos-list').innerHTML = rows.map(function (r) {
        var live = r.liquidity > 0n;
        return '<div class="pos" data-position="' + r.id + '">' +
          '<div class="pair">' + sym(r.token0) + ' / ' + sym(r.token1) + ' <span class="fee">' + (r.fee / 10000).toFixed(2) + '%</span> <span class="badge' + (live ? '' : ' off') + '">' + (live ? 'Active' : 'Fees only') + '</span></div>' +
          '<button class="btn ghost" data-withdraw="' + r.id + '" data-liquidity="' + r.liquidity + '"' + (live ? '' : ' disabled') + '>Withdraw</button>' +
          '<small>#' + r.id + ' · ticks ' + r.lower + ' to ' + r.upper + ' · liquidity ' + r.liquidity.toLocaleString('en-US') + '</small>' +
          '<small>Unclaimed ' + units(r.owed0, 18) + ' ' + sym(r.token0) + ' + ' + units(r.owed1, 18) + ' ' + sym(r.token1) + '</small></div>';
      }).join('');
    } catch (e) {
      status('Could not read positions: ' + ((e && e.message) || e));
    }
  }

  async function withdraw(btn) {
    var id = BigInt(btn.getAttribute('data-withdraw'));
    var liq = BigInt(btn.getAttribute('data-liquidity'));
    var deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    // decreaseLiquidity((tokenId, liquidity, amount0Min, amount1Min, deadline))
    var data = '0x0c49ccbe' + pad(id) + pad(liq) + pad(0n) + pad(0n) + pad(deadline);
    try {
      await eth().request({ method: 'eth_sendTransaction', params: [{ from: account, to: NPM, data: data, value: '0x0' }] });
      status('Withdrawal sent for position #' + id + '.');
    } catch (e) {
      status('Withdrawal cancelled.');
    }
  }

  async function deposit(btn) {
    var note = $('deposit-note');
    if (!account) await connect();
    if (!account) return;
    // step 1 of 2: an exact allowance for the position manager (100 DUSD), never unlimited
    var data = '0x095ea7b3' + pad(NPM) + pad(100n * 10n ** 18n);
    note.textContent = btn.getAttribute('data-deposit') + ': approve 100 DUSD for the pool (step 1 of 2)…';
    try {
      await eth().request({ method: 'eth_sendTransaction', params: [{ from: account, to: DUSD, data: data, value: '0x0' }] });
      note.textContent = 'Approved. Confirm the deposit to start earning fees.';
      if (window.confetti) window.confetti({ particleCount: 80, spread: 60, origin: { y: 0.3 } });
    } catch (e) {
      note.textContent = 'Deposit cancelled.';
    }
  }

  $('connect').addEventListener('click', function () { connect().catch(function (e) { status('Could not connect: ' + ((e && e.message) || e)); }); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-withdraw],[data-deposit]');
    if (!t) return;
    if (t.hasAttribute('data-withdraw')) withdraw(t);
    else deposit(t);
  });
  $('from').addEventListener('input', function () {
    var v = parseFloat($('from').value) || 0;
    $('to').value = (v / 3372.4).toFixed(4);
  });
  $('swap-go').addEventListener('click', function () { $('swap-go').textContent = 'Swaps reopen after the testnet upgrade'; });
  var links = document.querySelectorAll('nav a');
  links.forEach(function (a) { a.addEventListener('click', function () { links.forEach(function (x) { x.classList.toggle('on', x === a); }); }); });

  // ---------- Copeybara demo bar (the attack lab, not DemoSwap): shows and switches the demo mode ----------
  var bar = $('demobar');
  if (bar) {
    var meta = document.querySelector('meta[name="copeybara-demo-control"]');
    var CONTROL = (meta && meta.content) || 'http://localhost:8090';
    var onLookalike = location.hostname.indexOf('demoswap-rewards.') === 0;
    var cfg = null;
    var MODES = {
      normal: { switches: ['reset'], go: 'site' },
      hijack: { switches: ['reset', 'hijack-on'], go: 'site' },
      lookalike: { switches: ['reset'], go: 'lookalike' },
      approve: { switches: [], open: 'approve' },
      permit: { switches: [], open: 'permit' },
      nft: { switches: [], open: 'nft' },
      down: { switches: ['reset', 'site-down'], go: 'site' },
    };
    var show = function (mode, tone, html) {
      bar.setAttribute('data-tone', tone);
      bar.setAttribute('data-demo-mode', mode);
      bar.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === mode); });
      $('demo-text').innerHTML = html;
    };
    var getJson = function (path) { return fetch(CONTROL + path, { cache: 'no-store' }).then(function (r) { return r.json(); }); };
    var refreshBar = async function () {
      // what THIS page is, first: the bar's code is identical on the real site, the hijacked clone and the look-alike
      var injected = !!document.querySelector('script[src="/inject.js"]');
      var st = null;
      try {
        st = await getJson('/status');
        if (!cfg) cfg = await getJson('/portal/config');
      } catch (e) { /* controls offline: still say what this page is */ }
      if (onLookalike) return show('lookalike', 'warn', '<b>LOOK-ALIKE DOMAIN</b> · ' + location.hostname + ' is a copy on a domain DemoSwap does not own. The Copeybara watcher lists it on the ENS blocklist.');
      if (injected) return show('hijack', 'bad', '<b>DNS HIJACKED</b> · this page now injects a drainer. Same address, same look: Connect wallet and Deposit now ask for an unlimited approval.');
      if (st && st.hijack) return show('hijack', 'bad', '<b>DNS HIJACKED</b> · the domain now points at the attacker. Reload to get the hijacked page.');
      if (!st) return show('normal', 'ok', 'You are on the real DemoSwap: every script matches the ENS fingerprint. <span style="opacity:.7">(Demo controls offline: start the harness.)</span>');
      show('normal', 'ok', 'You are on the real DemoSwap: every script matches the ENS fingerprint.');
    };
    var post = function (sw) { return fetch(CONTROL + '/switch/' + sw, { method: 'POST' }).then(function (r) { if (!r.ok) throw new Error(sw); }); };
    bar.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var m = MODES[b.getAttribute('data-mode')];
        var tab = m.open ? window.open('about:blank', '_blank') : null; // inside the click: pop-up blockers
        b.disabled = true;
        try {
          if (!cfg) cfg = await getJson('/portal/config');
          for (var i = 0; i < m.switches.length; i++) await post(m.switches[i]);
          if (m.open) {
            if (tab) { tab.opener = null; tab.location.href = cfg.links[m.open]; } else window.open(cfg.links[m.open], '_blank', 'noopener');
          } else {
            location.href = cfg.links[m.go];
          }
        } catch (e) {
          if (tab) tab.close();
          $('demo-text').textContent = 'Demo controls offline: start the harness (pnpm --filter @copeybara/harness start).';
        } finally {
          b.disabled = false;
        }
      });
    });
    // first look once the whole page is parsed (an injected script after this bundle is in the DOM by then)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshBar);
    else refreshBar();
    setInterval(refreshBar, 3000);
  }
})();
