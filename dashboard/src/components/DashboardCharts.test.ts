import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colorForType, formatTick, shortChat } from '../utils/chartHelpers.ts';

test('colorForType: known types return stable, distinct colors', () => {
  // Known types should never change between renders
  assert.equal(colorForType('text'), '#25d366');
  assert.equal(colorForType('image'), '#3b82f6');
  assert.equal(colorForType('revoked'), '#f43f5e');
  assert.equal(colorForType('unknown'), '#64748b');
  assert.equal(colorForType('masked'), '#8b5cf6');
  assert.equal(colorForType('poll'), '#6366f1');
  assert.equal(colorForType('location'), '#84cc16');
});

test('colorForType: unknown name gets deterministic fallback color', () => {
  const a = colorForType('foobar');
  const b = colorForType('foobar');
  // Same name always gets the same color
  assert.equal(a, b);
  // Different names usually get different colors
  const c = colorForType('bazqux');
  assert.notEqual(a, c);
});

test('colorForType: empty string gets a color without throwing', () => {
  assert.doesNotThrow(() => colorForType(''));
  assert.equal(typeof colorForType(''), 'string');
});

test('formatTick: 24h period shows HH:MM', () => {
  assert.equal(formatTick('2026-06-24 14:00:00', '24h'), '14:00');
  assert.equal(formatTick('2026-06-24 09:05:00', '24h'), '09:05');
});

test('formatTick: 7d/30d period shows MM-DD', () => {
  assert.equal(formatTick('2026-06-24', '7d'), '06-24');
  assert.equal(formatTick('2026-12-31 00:00:00', '30d'), '12-31');
});

test('formatTick: day period with no time component', () => {
  assert.equal(formatTick('2026-01-01', '7d'), '01-01');
});

test('formatTick: day period with full datetime string', () => {
  assert.equal(formatTick('2026-12-31 00:00:00', '30d'), '12-31');
});

test('shortChat: strips @c.us suffix', () => {
  assert.equal(shortChat('62812345678@c.us'), '62812345678');
});

test('shortChat: strips @g.us suffix', () => {
  assert.equal(shortChat('1234567890-123456@g.us'), '1234567890-123456');
});

test('shortChat: strips @lid suffix', () => {
  assert.equal(shortChat('62812345678@lid'), '62812345678');
});

test('shortChat: returns full string when there is no @ separator', () => {
  assert.equal(shortChat('plain-id'), 'plain-id');
});

test('shortChat: handles empty string', () => {
  assert.equal(shortChat(''), '');
});
