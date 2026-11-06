/**
 * Container health: healthy once a tick has completed within the last `misses` intervals. A watcher that keeps
 * failing (RPCs down, ENS unreadable) turns unhealthy so the orchestrator restarts it and alerts someone.
 */
export function health(lastOkAt: number | null, now: number, intervalMs: number, misses = 4): { ok: boolean; detail: string } {
  if (lastOkAt === null) return { ok: false, detail: 'no completed check yet' };
  const age = now - lastOkAt;
  return age <= intervalMs * misses ? { ok: true, detail: `last check ${Math.round(age / 1000)} s ago` } : { ok: false, detail: `no completed check for ${Math.round(age / 1000)} s` };
}
