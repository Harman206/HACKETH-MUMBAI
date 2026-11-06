/**
 * Vector illustrations for the setup wizard and dashboard (inline SVG, animated with CSS in ui.css).
 * Decorative only: every one is aria-hidden and carries no information the text does not.
 */
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

/** Guilloche: a bundle of fine wavy lines, like the engraving on a premium card. */
function Guilloche({ n = 7, color }: { n?: number; color: string }) {
  return (
    <g fill="none" stroke={color} stroke-width="0.7" clip-path="url(#card-clip)">
      {Array.from({ length: n }, (_, i) => (
        <path d={`M40 ${150 - i * 5} C 110 ${150 - i * 5}, 120 ${70 - i * 4}, 190 ${74 - i * 6} S 260 ${40 - i * 4}, 300 ${30 - i * 3}`} />
      ))}
    </g>
  );
}

function Chip({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="30" height="23" rx="5" fill="url(#chip)" />
      <path d="M0 8h9m12 0h9M0 15h9m12 0h9M9 0v23m12-23v23M9 11.5h12" stroke="#5c7a1c" stroke-width="0.9" opacity=".55" fill="none" />
    </g>
  );
}

/** Three fanned cards (deep green, pale green, forest) that fan in on load and float. */
export function CardFan() {
  return (
    <svg class="fan" viewBox="0 0 340 250" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="c-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1d4a2c" />
          <stop offset="1" stop-color="#0c2316" />
        </linearGradient>
        <linearGradient id="c-mid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d4f497" />
          <stop offset="1" stop-color="#93c98a" />
        </linearGradient>
        <linearGradient id="c-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#21804a" />
          <stop offset=".55" stop-color="#145a31" />
          <stop offset="1" stop-color="#0b3a1f" />
        </linearGradient>
        <linearGradient id="chip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e6ff9a" />
          <stop offset="1" stop-color="#a9dc3a" />
        </linearGradient>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0" />
          <stop offset=".5" stop-color="#fff" stop-opacity=".22" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
        <clipPath id="card-clip">
          <rect x="40" y="40" width="260" height="164" rx="16" />
        </clipPath>
      </defs>
      <ellipse class="fan-shadow" cx="175" cy="232" rx="120" ry="9" fill="#000" opacity=".45" />
      <g class="fan-card c1">
        <rect x="40" y="40" width="260" height="164" rx="16" fill="url(#c-back)" />
        <Guilloche color="rgba(196,250,79,.18)" />
      </g>
      <g class="fan-card c2">
        <rect x="40" y="40" width="260" height="164" rx="16" fill="url(#c-mid)" />
        <Guilloche color="rgba(20,22,21,.14)" />
      </g>
      <g class="fan-card c3">
        <rect x="40" y="40" width="260" height="164" rx="16" fill="url(#c-front)" />
        <rect x="40.5" y="40.5" width="259" height="163" rx="15.5" fill="none" stroke="rgba(255,255,255,.18)" />
        <Guilloche n={9} color="rgba(196,250,79,.28)" />
        <Chip x={64} y={92} />
        <g transform="translate(262 58) scale(.24)" fill="#c4fa4f">
          <path fill-rule="evenodd" d="M10 73c2-17 10-33 19-46a7 7 0 0 1-3-6 8 8 0 0 1 15-3c6-2 13-1 20 1l27 6c4 1 6 3 6 7v17c0 7-4 10-10 11l-24 2-9 11H10Zm52-36a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        </g>
        <text x="64" y="180" fill="rgba(255,255,255,.82)" font-family="JetBrains Mono, ui-monospace, monospace" font-size="11" letter-spacing="2.5">EXIT · VERIFIED</text>
        <g clip-path="url(#card-clip)">
          <rect class="fan-sheen" x="-60" y="30" width="70" height="190" fill="url(#sheen)" transform="skewX(-18)" />
        </g>
      </g>
    </svg>
  );
}

/** ENS name at the centre, records orbiting: the protocol's published fingerprints. */
export function EnsGraph() {
  const nodes = [
    { x: 60, y: 60, l: 'kit' },
    { x: 280, y: 52, l: 'site' },
    { x: 290, y: 178, l: 'exits' },
    { x: 52, y: 182, l: 'status' },
  ];
  return (
    <svg class="art ens" viewBox="0 0 340 240" aria-hidden="true" focusable="false">
      <circle cx="170" cy="120" r="92" fill="none" stroke="rgba(196,250,79,.14)" stroke-dasharray="2 6" class="spin" />
      <circle cx="170" cy="120" r="62" fill="none" stroke="rgba(196,250,79,.22)" />
      {nodes.map((n, i) => (
        <g class="node-in" style={`--d:${i * 120}ms`}>
          <path d={`M170 120 L${n.x} ${n.y}`} stroke="rgba(196,250,79,.5)" stroke-width="1.4" class="draw" />
          <circle cx={n.x} cy={n.y} r="20" fill="#0f2418" stroke="rgba(196,250,79,.55)" />
          <text x={n.x} y={n.y + 4} text-anchor="middle" fill="#d4f497" font-family="JetBrains Mono, monospace" font-size="10">{n.l}</text>
        </g>
      ))}
      <circle cx="170" cy="120" r="38" fill="#c4fa4f" class="core" />
      <text x="170" y="126" text-anchor="middle" fill="#141615" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="17">.eth</text>
    </svg>
  );
}

/** Three RPC paths converging on one agreed answer (2-of-3 quorum). */
export function RpcQuorum() {
  const ys = [44, 120, 196];
  return (
    <svg class="art quorum" viewBox="0 0 340 240" aria-hidden="true" focusable="false">
      {ys.map((y, i) => (
        <g>
          <rect x="22" y={y - 18} width="78" height="36" rx="10" fill="#0f2418" stroke="rgba(196,250,79,.45)" />
          <circle cx="40" cy={y} r="4" fill="#c4fa4f" class="blink" style={`--d:${i * 300}ms`} />
          <path d={`M52 ${y - 4}h34M52 ${y + 4}h22`} stroke="rgba(212,244,151,.55)" stroke-width="2" stroke-linecap="round" />
          <path d={`M100 ${y} C 170 ${y}, 170 120, 236 120`} fill="none" stroke="rgba(196,250,79,.25)" stroke-width="1.5" />
          <path d={`M100 ${y} C 170 ${y}, 170 120, 236 120`} fill="none" stroke="#c4fa4f" stroke-width="2" class="flow" style={`--d:${i * 350}ms`} />
        </g>
      ))}
      <circle cx="270" cy="120" r="36" fill="#c4fa4f" class="core" />
      <path d="m255 121 10 10 20-21" fill="none" stroke="#141615" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      <text x="270" y="180" text-anchor="middle" fill="#d4f497" font-family="JetBrains Mono, monospace" font-size="11">2 of 3 agree</text>
    </svg>
  );
}

/** Expanding shield rings behind the hero mascot on the Done step. */
export function ShieldBurst({ children }: { children: ComponentChildren }) {
  return (
    <div class="burst">
      <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
        <circle cx="120" cy="120" r="70" class="ring r1" />
        <circle cx="120" cy="120" r="70" class="ring r2" />
        <circle cx="120" cy="120" r="70" class="ring r3" />
        <path class="shield-draw" d="M120 30 58 56v46c0 40 26 74 62 86 36-12 62-46 62-86V56Z" fill="none" stroke="#c4fa4f" stroke-width="3" stroke-linejoin="round" />
      </svg>
      {children}
    </div>
  );
}

/** Dark hero band: display headline + illustration, with a gentle pointer tilt. */
export function Hero({ eyebrow, title, sub, art, class: cls }: { eyebrow: string; title: ComponentChildren; sub?: ComponentChildren; art: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tx', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`);
    el.style.setProperty('--ty', `${-((e.clientY - r.top) / r.height - 0.5) * 8}deg`);
  };
  const leave = () => {
    ref.current?.style.setProperty('--tx', '0deg');
    ref.current?.style.setProperty('--ty', '0deg');
  };
  return (
    <div class={`hero${cls ? ` ${cls}` : ''}`} ref={ref} onPointerMove={move} onPointerLeave={leave}>
      <div class="hero-copy">
        <p class="eyebrow">{eyebrow}</p>
        <h1 class="display">{title}</h1>
        {sub && <p class="hero-sub">{sub}</p>}
      </div>
      <div class="hero-art">{art}</div>
    </div>
  );
}
