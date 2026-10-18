import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTimeSeriesGaps } from './chartHelpers.ts';

const NOW = new Date('2026-10-18T06:45:00Z');

test('30d fills every day of the window with zeros where the server returned no bucket', () => {
  const filled = fillTimeSeriesGaps(
    [
      { timestamp: '2026-09-23', sent: 1, received: 2 },
      { timestamp: '2026-10-17', sent: 3, received: 4 },
    ],
    '30d',
    NOW,
  );
  assert.equal(filled.length, 31);
  assert.equal(filled[0].timestamp, '2026-09-18');
  assert.equal(filled[filled.length - 1].timestamp, '2026-10-18');
  assert.deepEqual(
    filled.find(p => p.timestamp === '2026-09-23'),
    { timestamp: '2026-09-23', sent: 1, received: 2 },
  );
  assert.deepEqual(
    filled.find(p => p.timestamp === '2026-10-01'),
    { timestamp: '2026-10-01', sent: 0, received: 0 },
  );
});

test('24h fills hour buckets in the server format', () => {
  const filled = fillTimeSeriesGaps([{ timestamp: '2026-10-18 05:00:00', sent: 2, received: 0 }], '24h', NOW);
  assert.equal(filled.length, 25);
  assert.equal(filled[0].timestamp, '2026-10-17 06:00:00');
  assert.equal(filled[filled.length - 1].timestamp, '2026-10-18 06:00:00');
  assert.equal(filled.find(p => p.timestamp === '2026-10-18 05:00:00')?.sent, 2);
});

test('keeps server buckets that fall outside the generated grid, in order', () => {
  const filled = fillTimeSeriesGaps([{ timestamp: '2026-10-19', sent: 1, received: 1 }], '7d', NOW);
  assert.equal(filled[filled.length - 1].timestamp, '2026-10-19');
  const keys = filled.map(p => p.timestamp);
  assert.deepEqual(keys, [...keys].sort());
});
