import { BrandMark } from './Icons';

/** Static illustration of the extension's confirm window (wording from apps/extension/src/pages/confirm.tsx). */
export function ExtensionPreview() {
  return (
    <figure class="ext-preview">
      <div class="ext-window" aria-hidden="true">
        <div class="ext-bar">
          <span class="ext-brand"><BrandMark />Copeybara</span>
          <span class="pill bad">Dangerous</span>
        </div>
        <div class="ext-card">
          <p class="ext-label">High risk</p>
          <p class="ext-title">This looks like a wallet drainer</p>
          <p class="ext-small"><span class="mono">https://demoswap-rewards.xyz</span> asked your wallet for <b class="mono">eth_sendTransaction</b>.</p>
          <ul class="ext-reasons">
            <li>This lets 0x9d1f…c0de spend all of your USDC. No protocol you follow publishes that address: this is how wallet drainers work.</li>
          </ul>
        </div>
        <div class="ext-decide">
          <span class="ext-btn">Cancel request (recommended)</span>
          <span class="ext-check"><i />I understand this can give away the tokens in my wallet.</span>
          <span class="ext-btn ghost">Continue to my wallet anyway</span>
        </div>
        <div class="ext-toast">Saved by Copey!</div>
      </div>
      <figcaption>Illustration of the confirm window. It opens before your wallet’s own popup; Cancel is the default.</figcaption>
    </figure>
  );
}
