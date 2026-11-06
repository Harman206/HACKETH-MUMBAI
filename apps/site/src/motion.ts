import { useEffect, useRef, useState } from 'preact/hooks';

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades [data-reveal] elements in once as they scroll into view. Without IntersectionObserver, or with reduced motion, they are shown at once. */
export function useReveal(key: unknown) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
    if (typeof IntersectionObserver === 'undefined' || reducedMotion()) {
      for (const e of els) e.classList.add('is-in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    for (const e of els) io.observe(e);
    return () => io.disconnect();
  }, [key]);
}

/** True while the element is on screen, so animations stop when nobody can see them. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.2 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, visible] as const;
}

/** Counts from 0 to `to` once `start` turns true. */
export function useCountUp(to: number, start: boolean, ms = 1400) {
  const [n, setN] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (!start || reducedMotion() || typeof requestAnimationFrame === 'undefined') return setN(to);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setN(to * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, to]);
  return n;
}
