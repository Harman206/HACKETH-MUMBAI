/**
 * "Saved by Copey!": a short full-screen celebration when Copeybara has just saved the user (a cancelled drainer
 * request, a blocked page). A shower of Copeys, one line saying what was avoided, a jingle, then it goes away by
 * itself. Decorative only: the page underneath already carries the real information. The overlay lets clicks pass
 * through outside its panel, so it never blocks the page it sits on.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import copeyProtected from './img/copey-protected.png';
import copeyVerified from './img/copey-verified.png';
import copeyChecking from './img/copey-checking.png';
import { isMuted, playCopeySong, setMuted, type Playing } from './song';
import { Icon } from './icons';

/** the "Capybara" song itself is not ours to ship: we only link to it */
export const CAPYBARA_SONG_URL = 'https://www.youtube.com/watch?v=8Pj-YEQbojk';
const DEFAULT_MS = 5000;
const MAX_MS = 9500;

declare const chrome: { runtime: { getURL(p: string): string }; tabs?: { create(p: { url: string }): Promise<unknown> } };

/** The user's own song, if this is a local build that includes one (see scripts/build.mjs). Never in a release. */
async function ownSong(): Promise<string | null> {
  for (const f of ['audio/copey-song.m4a', 'audio/copey-song.mp3']) {
    try {
      const url = chrome.runtime.getURL(f);
      const r = await fetch(url, { method: 'HEAD' }).catch(() => fetch(url));
      if (r.ok) return url;
    } catch {
      /* not there */
    }
  }
  return null;
}

const reducedMotion = () => {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

const IMGS = [copeyVerified, copeyProtected, copeyVerified, copeyChecking];

/** Deterministic pseudo-random sprites (same shower every time; no Math.random in render). */
function sprites(n: number) {
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => ({
    img: IMGS[i % IMGS.length]!,
    x: Math.round(rnd() * 100),
    size: Math.round(44 + rnd() * 52),
    delay: +(rnd() * 2.6).toFixed(2),
    dur: +(2.4 + rnd() * 2).toFixed(2),
    rot: Math.round(rnd() * 720 - 360),
    drift: Math.round(rnd() * 120 - 60),
  }));
}

export function Celebration({ reason, autoplay, onDone }: { reason: string; autoplay: boolean; onDone(): void }) {
  const still = useMemo(reducedMotion, []);
  const [muted, setM] = useState(isMuted);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [needsTap, setNeedsTap] = useState(!autoplay);
  const [hold, setHold] = useState(false); // the user opened the song link: do not auto-dismiss under them
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const sound = useRef<Playing | null>(null);
  const play = async () => {
    sound.current?.stop();
    const p = await playCopeySong({ fileUrl: await ownSong() });
    if (done.current) return p.stop(); // dismissed while loading
    sound.current = p.ok ? p : null;
    setPlaying(p.ok ? p : null);
    setNeedsTap(!p.ok);
    return p;
  };
  // autoplay (after the user's own click, e.g. Cancel) unless muted
  useEffect(() => {
    if (autoplay && !muted) void play();
    return () => sound.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // auto-dismiss after ~5 s, or when the song ends (capped)
  useEffect(() => {
    if (hold) return;
    const ms = Math.min(MAX_MS, Math.max(DEFAULT_MS, playing ? playing.seconds * 1000 + 300 : 0));
    const t = setTimeout(finish, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, hold]);
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
          <img
            class="celebrate-copey"
            src={s.img}
            alt=""
            draggable={false}
            style={{ '--x': `${s.x}%`, '--s': `${s.size}px`, '--d': `${s.delay}s`, '--t': `${s.dur}s`, '--r': `${s.rot}deg`, '--dx': `${s.drift}px` }}
          />
        ))}
        {!still && Array.from({ length: 5 }, (_, i) => <img class="celebrate-hop" src={copeyVerified} alt="" draggable={false} style={{ '--i': i }} />)}
      </div>
      <div class="celebrate-panel">
        <button
          id="celebrate-mute"
          class="celebrate-mute"
          aria-pressed={muted}
          aria-label={muted ? 'Sound off (turn on)' : 'Sound on (mute)'}
          title={muted ? 'Sound off' : 'Sound on'}
          onClick={toggleMute}
        >
          <Icon name={muted ? 'volume-x' : 'volume'} size={16} />
        </button>
        <img class="celebrate-hero" src={copeyVerified} alt="" width={132} height={132} draggable={false} />
        <h1 class="celebrate-title">Saved by Copey!</h1>
        <p class="celebrate-reason" data-celebration-reason>{reason}</p>
        <div class="celebrate-actions">
          <button id="celebrate-done" class="celebrate-done" onClick={finish}>Done</button>
          {needsTap && !muted && (
            <button id="celebrate-play" class="celebrate-ghost" onClick={() => void play()}>
              <Icon name="volume" size={16} />Play the Copey song
            </button>
          )}
        </div>
        <button
          id="celebrate-capybara"
          class="celebrate-link"
          onClick={() => {
            sound.current?.stop();
            setPlaying(null);
            setHold(true);
            if (chrome.tabs?.create) void chrome.tabs.create({ url: CAPYBARA_SONG_URL });
            else globalThis.open?.(CAPYBARA_SONG_URL, '_blank', 'noopener');
          }}
        >
          Play the Capybara song ↗
        </button>
      </div>
    </div>
  );
}
