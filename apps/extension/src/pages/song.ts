/**
 * The "Saved by Copey" sound. An original ~4 s jingle composed for Copeybara (Web Audio: a square-wave lead, a
 * triangle bass and synthesized drums), plus a chant of the word "Capybara" spoken by a LOCAL speech voice
 * (voices that need the network are skipped). No sample, melody or lyric of any existing song is used.
 * Optional: a song file the user supplies (played from SONG_START_S for SONG_LENGTH_S, fading out over SONG_FADE_S).
 * Browsers only allow audio after the user has interacted with the page: play() reports whether it could start.
 */

/** where the user's own song starts (seconds); tweak to land on the chorus */
export const SONG_START_S = 0;
export const SONG_LENGTH_S = 8;
export const SONG_FADE_S = 1;
export const CHANT = 'Capybara, capybara, capybara!';

const MUTE_KEY = 'copeybara.muted';
export function isMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setMuted(m: boolean): void {
  try {
    globalThis.localStorage?.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* storage blocked: the toggle still works for this page */
  }
}

export interface Playing {
  /** false when the browser refused to start audio (no user gesture yet): offer a play button */
  ok: boolean;
  /** how long the sound lasts, in seconds */
  seconds: number;
  stop(): void;
}

const NONE: Playing = { ok: false, seconds: 0, stop() {} };

// ---------- the original jingle ----------
// 150 bpm, eighth notes (0.2 s). [midi note, start (eighths), length (eighths)]. Composed for Copeybara.
const STEP = 0.2;
const LEAD: [number, number, number][] = [
  [72, 0, 1], [76, 1, 1], [79, 2, 1], [76, 3, 1], [81, 4, 2], [79, 6, 1], [76, 7, 1],
  [77, 8, 1], [81, 9, 1], [84, 10, 1], [81, 11, 1], [79, 12, 2], [76, 14, 1], [74, 15, 1],
  [72, 16, 1], [79, 17, 1], [84, 18, 2],
];
const BASS: [number, number, number][] = [
  [48, 0, 2], [55, 2, 2], [48, 4, 2], [55, 6, 2], [53, 8, 2], [57, 10, 2], [55, 12, 2], [50, 14, 2], [48, 16, 4],
];
const KICK = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
const SNARE = [2, 6, 10, 14, 17];
const JINGLE_S = 20 * STEP + 0.4;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, midi: number, t: number, len: number, vol: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(hz(midi), t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, t + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, t: number, len: number, vol: number, highpass: number) {
  const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * len)), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647; // deterministic noise
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  const s = ctx.createBufferSource();
  s.buffer = b;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = highpass;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(f).connect(g).connect(out);
  s.start(t);
}

function kick(ctx: AudioContext, out: AudioNode, t: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.18);
}

async function jingle(): Promise<Playing> {
  const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return NONE;
  let ctx: AudioContext;
  try {
    ctx = new AC();
  } catch {
    return NONE;
  }
  if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 250))]);
  if (ctx.state !== 'running') {
    void ctx.close().catch(() => {});
    return NONE;
  }
  const master = ctx.createGain();
  master.gain.value = 0.32;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.connect(master).connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05;
  for (const [m, s, l] of LEAD) tone(ctx, lp, 'square', m, t0 + s * STEP, l * STEP * 0.92, 0.22);
  for (const [m, s, l] of LEAD) tone(ctx, lp, 'triangle', m + 12, t0 + s * STEP, l * STEP * 0.6, 0.07); // sparkle an octave up
  for (const [m, s, l] of BASS) tone(ctx, master, 'triangle', m, t0 + s * STEP, l * STEP * 0.9, 0.5);
  for (const s of KICK) kick(ctx, master, t0 + s * STEP);
  for (const s of SNARE) noise(ctx, master, t0 + s * STEP, 0.12, 0.35, 1800);
  for (let s = 0; s < 20; s++) noise(ctx, master, t0 + s * STEP + (s % 2 ? 0.1 : 0), 0.035, 0.12, 7000); // hi-hats
  noise(ctx, master, t0 + 18 * STEP, 0.9, 0.25, 4000); // final splash
  const end = setTimeout(() => void ctx.close().catch(() => {}), (JINGLE_S + 0.5) * 1000);
  return { ok: true, seconds: JINGLE_S, stop: () => (clearTimeout(end), void ctx.close().catch(() => {})) };
}

// ---------- the chant (local voices only) ----------
async function localVoice(): Promise<SpeechSynthesisVoice | null> {
  const ss = globalThis.speechSynthesis;
  if (!ss) return null;
  let vs = ss.getVoices();
  if (vs.length === 0) {
    await new Promise<void>((r) => {
      const t = setTimeout(r, 400);
      ss.addEventListener?.('voiceschanged', () => (clearTimeout(t), r()), { once: true });
    });
    vs = ss.getVoices();
  }
  const local = vs.filter((v) => v.localService);
  return local.find((v) => /^en(-|_|$)/i.test(v.lang)) ?? local[0] ?? null;
}

function chant(delayMs: number): () => void {
  const ss = globalThis.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return () => {};
  let cancelled = false;
  const timer = setTimeout(async () => {
    const v = await localVoice();
    if (!v || cancelled) return; // no local voice: never fall back to a network voice
    const u = new SpeechSynthesisUtterance(CHANT);
    u.voice = v;
    u.lang = v.lang;
    u.rate = 1.15;
    u.pitch = 1.5;
    u.volume = 1;
    ss.speak(u);
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    try {
      ss.cancel();
    } catch {
      /* ignore */
    }
  };
}

// ---------- a song file the user supplied ----------
async function file(url: string): Promise<Playing> {
  const a = new Audio(url);
  a.preload = 'auto';
  a.volume = 1;
  try {
    a.currentTime = SONG_START_S;
  } catch {
    /* set once metadata is in */
  }
  a.addEventListener('loadedmetadata', () => {
    if (Math.abs(a.currentTime - SONG_START_S) > 0.5) a.currentTime = SONG_START_S;
  }, { once: true });
  try {
    await a.play();
  } catch {
    return NONE;
  }
  const steps = 20;
  let fade: ReturnType<typeof setInterval> | null = null;
  const fadeAt = setTimeout(() => {
    let i = 0;
    fade = setInterval(() => {
      a.volume = Math.max(0, 1 - ++i / steps);
      if (i >= steps) stop();
    }, (SONG_FADE_S * 1000) / steps);
  }, (SONG_LENGTH_S - SONG_FADE_S) * 1000);
  const stop = () => {
    clearTimeout(fadeAt);
    if (fade) clearInterval(fade);
    a.pause();
  };
  return { ok: true, seconds: SONG_LENGTH_S, stop };
}

/** Play the celebration sound: the user's song file when given (and playable), else the jingle + chant. */
export async function playCopeySong(o: { fileUrl?: string | null } = {}): Promise<Playing> {
  if (o.fileUrl) {
    const p = await file(o.fileUrl).catch(() => NONE);
    if (p.ok) return p;
  }
  const j = await jingle();
  if (!j.ok) return NONE;
  const stopChant = chant(1700);
  return { ok: true, seconds: Math.max(j.seconds, 4.6), stop: () => (j.stop(), stopChant()) };
}
