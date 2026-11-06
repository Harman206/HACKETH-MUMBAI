import type { PositionBadge } from '@copeybara/core';

/** Notes an adapter attaches to a position (Uniswap v4 hook permissions), as small chips under the row title. */
export function PositionBadges({ badges }: { badges?: PositionBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <div class="prow-badges" data-badges style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
      {badges.map((b) => (
        <span class={b.tone === 'warn' ? 'chip warn-chip' : 'chip'} data-badge={b.tone} style={{ whiteSpace: 'normal' }}>
          {b.text}
        </span>
      ))}
    </div>
  );
}
