// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { h, render } from 'preact';
import { PositionBadges } from '../src/screens/Badges';

const mount = (badges: Parameters<typeof PositionBadges>[0]['badges']) => {
  const el = document.createElement('div');
  render(h(PositionBadges, { badges }), el);
  return el;
};

describe('position badges in the kit row', () => {
  test('nothing is rendered without badges', () => {
    expect(mount(undefined).innerHTML).toBe('');
    expect(mount([]).innerHTML).toBe('');
  });
  test('info and warn badges render as chips with their text', () => {
    const el = mount([
      { tone: 'info', text: 'Hook 0x1200…0301' },
      { tone: 'warn', text: "This pool's hook runs when you withdraw and can block or delay exits" },
    ]);
    const chips = Array.from(el.querySelectorAll('[data-badge]'));
    expect(chips.map((c) => [c.getAttribute('data-badge'), c.textContent])).toEqual([
      ['info', 'Hook 0x1200…0301'],
      ['warn', "This pool's hook runs when you withdraw and can block or delay exits"],
    ]);
    expect(chips[1]!.className).toContain('warn-chip');
  });
});
