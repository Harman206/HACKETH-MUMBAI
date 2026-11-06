/**
 * "Saved by Copey!": a short full-screen moment when an exit comes back Recovered. A shower of capybaras (inline SVG
 * built from the brand mark: the kit ships no images), one line on what came back, an original jingle, then it goes
 * away by itself. Decorative only: the position rows underneath carry the real result ([data-status]). Clicks outside
 * the panel pass through to the page.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CAPY_PATH } from './Icons';
import { isMuted, playCopeySong, setMuted, type Playing } from '../song';

const DEFAULT_MS = 5000;
const MAX_MS = 9000;

const reducedMotion = () => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

/** Deterministic sprites (the same shower every time). */
function sprites(n: number) {
  let seed = 7654321;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({
    tone: i % 3,
    x: Math.round(rnd() * 100),
    size: Math.round(34 + rnd() * 46),
    delay: +(rnd() * 2.6).toFixed(2),
    dur: +(2.4 + rnd() * 2).toFixed(2),
    rot: Math.round(rnd() * 720 - 360),
    drift: Math.round(rnd() * 120 - 60),
    flip: rnd() < 0.5,
  }));
}

function Capy({ tone, flip, class: cls, style }: { tone: number; flip?: boolean; class: string; style?: Record<string, string | number> }) {
  return (
    <svg class={`${cls} capy-t${tone}`} viewBox="0 0 104 104" aria-hidden="true" style={style}>
      {tone === 2 && <rect width="104" height="104" rx="26" fill="#141615" stroke="#c4fa4f" stroke-width="3" />}
      <path fill-rule="evenodd" transform={flip ? 'translate(93 17) scale(-.8 .8)' : 'translate(11 17) scale(.8)'} d={CAPY_PATH} />
    </svg>
  );
}

const Speaker = ({ off }: { off?: boolean }) => (
  <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z" />
    {off ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
  </svg>
);

export function Celebration({ reason, onDone }: { reason: string; onDone(): void }) {
  const still = useMemo(reducedMotion, []);
  const [muted, setM] = useState(isMuted);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const sound = useRef<Playing | null>(null);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const play = async () => {
    sound.current?.stop();
    const p = await playCopeySong();
    if (done.current) return p.stop();
    sound.current = p.ok ? p : null;
    setPlaying(p.ok ? p : null);
    setNeedsTap(!p.ok);
  };
  // The user clicked Exit earlier on this page, so the browser usually lets the sound start; if not, offer a button.
  useEffect(() => {
    if (!muted) void play();
    else setNeedsTap(false);
    return () => sound.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(finish, Math.min(MAX_MS, Math.max(DEFAULT_MS, playing ? playing.seconds * 1000 + 300 : 0)));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
  const toggleMute = () => {
    const m = !muted;
    setM(m);
    setMuted(m);
    if (m) {
      sound.current?.stop();
      setPlaying(null);
    }
  };
  const list = useMemo(() => sprites(still ? 9 : 30), [still]);
  return (
    <div class={`celebrate${still ? ' still' : ''}`} data-celebration role="status" aria-live="polite">
      <div class="celebrate-sky" aria-hidden="true">
        {list.map((s) => (
          <Capy class="celebrate-capy" tone={s.tone} flip={s.flip} style={{ '--x': `${s.x}%`, '--s': `${s.size}px`, '--d': `${s.delay}s`, '--t': `${s.dur}s`, '--r': `${s.rot}deg`, '--dx': `${s.drift}px` }} />
        ))}
        {!still && Array.from({ length: 5 }, (_, i) => <Capy class="celebrate-hop" tone={0} style={{ '--i': i }} />)}
      </div>
      <div class="celebrate-panel">
        <button class="celebrate-mute" aria-pressed={muted} aria-label={muted ? 'Sound off (turn on)' : 'Sound on (mute)'} title={muted ? 'Sound off' : 'Sound on'} onClick={toggleMute}>
          <Speaker off={muted} />
        </button>
        <Capy class="celebrate-hero" tone={2} />
        <h2 class="celebrate-title">Saved by Copey!</h2>
        <p class="celebrate-reason" data-celebration-reason>{reason}</p>
        <div class="celebrate-actions">
          <button class="celebrate-done" onClick={finish}>Done</button>
          {needsTap && !muted && (
            <button class="celebrate-ghost" onClick={() => void play()}>
              <Speaker /> Play the Copey song
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
