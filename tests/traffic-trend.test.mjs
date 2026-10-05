import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHistory, parseDisplayedCounter, makeSeries, makeGeometry, makePaths } from '../assets/js/traffic-trend.mjs';

const hour = 3600000;
const now = Date.parse('2026-10-05T12:00:00Z');
const history = samples => ({ version: 1, site: 'https://wenbo-wei.github.io/', samples });

test('accepts real zero and localized counts but not placeholders or decimals', () => {
  for (const locale of ['en-US', 'de-DE', 'fr-FR', 'ar-EG', 'de-CH', 'es-ES', 'it-IT']) {
    assert.equal(parseDisplayedCounter(new Intl.NumberFormat(locale).format(12345), locale), 12345);
  }
  assert.equal(parseDisplayedCounter('0', 'en-US'), 0);
  for (const text of ['—', '', '-1', '1.5', 'not available', '9007199254740992']) {
    assert.equal(parseDisplayedCounter(text, 'en-US'), null);
  }
});

test('requires the correct site, safe counters and chronological timestamps with timezones', () => {
  const sample = { at: '2026-10-05T06:00:00Z', views: 0 };
  assert.equal(normalizeHistory(history([sample]))[0].views, 0);
  for (const value of [
    { ...history([sample]), site: 'https://example.com/' },
    history([sample, sample]),
    history([{ ...sample, at: '2026-10-05T06:00:00' }]),
    history([{ ...sample, views: -1 }]),
  ]) assert.throws(() => normalizeHistory(value));
});

test('shows only actual observations, preserves gaps and does not mutate history', () => {
  const source = [{ time: now - 32 * 24 * hour, views: 1 }, { time: now - 6 * hour, views: 8 }];
  const actual = makeSeries(source, { time: now, views: 9 }, now);
  assert.deepEqual(actual.map(point => point.views), [8, 9]);
  assert.equal(source.length, 2);
  assert.deepEqual(makeSeries([], { time: now, views: 0 }, now), [{ time: now, views: 0 }]);
});

test('one observation is a point rather than a fabricated historical line', () => {
  const points = makeGeometry([{ time: now, views: 3 }]);
  assert.equal(points.length, 1);
  assert.deepEqual(makePaths(points), []);
});

test('does not draw across missing samples or counter resets', () => {
  for (const source of [
    [{ time: now - 30 * hour, views: 1 }, { time: now - 24 * hour, views: 2 }, { time: now - 6 * hour, views: 3 }, { time: now, views: 4 }],
    [{ time: now - 18 * hour, views: 8 }, { time: now - 12 * hour, views: 9 }, { time: now - 6 * hour, views: 1 }, { time: now, views: 2 }],
  ]) assert.equal(makePaths(makeGeometry(source)).length, 2);
});

test('constant and changing totals remain finite and inside the plotting bounds', () => {
  for (const values of [[0, 0], [100, 100], [0, 1000]]) {
    const points = makeGeometry(values.map((views, i) => ({ time: now - (1 - i) * 6 * hour, views })));
    for (const point of points) {
      assert.ok(Number.isFinite(point.x) && point.x >= 10 && point.x <= 470);
      assert.ok(Number.isFinite(point.y) && point.y >= 14 && point.y <= 74);
    }
    assert.ok(!makePaths(points)[0].line.includes('NaN'));
  }
});
