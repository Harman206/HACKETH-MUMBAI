import { expect, test } from 'vitest';
import { VERSION } from '../src';

test('core exports its version', () => {
  expect(VERSION).toBe('0.1.0');
});
