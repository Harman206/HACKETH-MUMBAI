import type { TState } from './chapters';

/** `?booth=` must point at the local harness (http://localhost or 127.0.0.1). */
export function boothUrl(href: string): string | null {
  try {
    const b = new URL(href).searchParams.get('booth');
    if (!b || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(b)) return null;
    return b.replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function theaterApi(base: string) {
  const j = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const r = await fetch(`${base}${path}`, { ...init, headers: { 'content-type': 'application/json' } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
    return body as T;
  };
  return {
    state: () => j<TState>('/theater/state'),
    prepare: (victim: string) => j<{ txs: string[] }>('/theater/prepare', { method: 'POST', body: JSON.stringify({ victim }) }),
    switch: (name: 'site-down' | 'rpc-down' | 'hijack-on' | 'reset') => j<{ ok: boolean }>(`/switch/${name}`, { method: 'POST' }),
    verify: () => j<{ real: string; tampered: string }>('/theater/verify', { method: 'POST' }),
    hijackRequest: () => j<{ to: string; data: string; value: string }>('/theater/hijack-request'),
  };
}
