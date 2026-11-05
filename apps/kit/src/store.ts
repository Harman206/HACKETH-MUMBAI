/** Tiny observable value (no dependency). */
export interface Store<T> {
  get(): T;
  set(v: T): void;
  subscribe(fn: (v: T) => void): () => void;
}

export function store<T>(initial: T): Store<T> {
  let v = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => v,
    set: (n) => {
      v = n;
      for (const s of subs) s(v);
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
