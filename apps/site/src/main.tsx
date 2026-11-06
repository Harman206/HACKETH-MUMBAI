import { render } from 'preact';
import { App } from './App';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Offline copy of this page and the hosted kit (see scripts/write-sw.mjs). Same-origin only; no third parties.
if ('serviceWorker' in navigator && window.isSecureContext) void navigator.serviceWorker.register('sw.js').catch(() => {});
