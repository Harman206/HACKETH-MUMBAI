/** Small inline SVG diagrams for "How it works" (no external assets). */
const s = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
export const Icons = [
  // remote control → contract, bypassing a broken website
  <svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="14" width="12" height="20" rx="3" {...s} /><rect x="32" y="12" width="12" height="24" rx="2" {...s} /><path class="flow" d="M16 24h16" {...s} /><path d="M20 8l8 8M28 8l-8 8" {...s} stroke="#c0362c" /></svg>,
  // fingerprint matching a record
  <svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M14 30c0-8 4-14 10-14s10 6 10 14M18 32c0-6 2-10 6-10s6 4 6 10M24 26v8" {...s} /><path d="M34 38l4 4 8-10" {...s} stroke="#12805c" /></svg>,
  // checklist with a crossed approval
  <svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="6" width="28" height="36" rx="3" {...s} /><path d="M14 16l3 3 6-6M14 28l3 3 6-6" {...s} stroke="#12805c" /><path d="M32 30l10 10M42 30L32 40" {...s} stroke="#c0362c" /></svg>,
  // three servers agreeing
  <svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="8" width="12" height="8" rx="2" {...s} /><rect x="4" y="20" width="12" height="8" rx="2" {...s} /><rect x="4" y="32" width="12" height="8" rx="2" {...s} /><path class="flow" d="M16 12l14 12M16 24h14M16 36l14-12" {...s} /><circle cx="36" cy="24" r="6" {...s} /></svg>,
];
