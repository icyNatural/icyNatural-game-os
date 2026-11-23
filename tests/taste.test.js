'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, signal, experience, tasteInput, daysAgoIso } = require('./helpers');

const GOS = load();
const taste = GOS.taste;

function find(patterns, key) {
  const hit = patterns.filter((p) => p.key === key);
  assert.ok(hit.length, `pattern ${key} exists`);
  return hit[0];
}

test('positive-only signals produce a positive, non-contradictory pattern', () => {
  const now = new Date().toISOString();
  const signals = [
    signal({ id: 's1', key: 'exploration', polarity: 'positive', importance: 3, experienceId: 'exp:1', created_at: daysAgoIso(1, now) }),
    signal({ id: 's2', key: 'exploration', polarity: 'positive', importance: 3, experienceId: 'exp:2', created_at: daysAgoIso(2, now) }),
    signal({ id: 's3', key: 'exploration', polarity: 'positive', importance: 3, experienceId: 'exp:3', created_at: daysAgoIso(3, now) })
  ];
  const patterns = taste.computePatterns(tasteInput(signals, [
    experience({ id: 'exp:1', gameId: 'game:a' }),
    experience({ id: 'exp:2', gameId: 'game:b' }),
    experience({ id: 'exp:3', gameId: 'game:c' })
  ], now));
  const p = find(patterns, 'exploration');
  assert.strictEqual(p.polarity, 'positive');
  assert.strictEqual(p.contradictory, false);
  assert.strictEqual(p.frequency, 3);
  assert.strictEqual(p.distinctGames, 3);
  assert.strictEqual(p.net, 1);
  assert.strictEqual(p.strength, 'strong');
});

test('mixed polarity stays visible as a contradiction with both game lists', () => {
  const now = new Date().toISOString();
  const signals = [
    signal({ id: 's1', key: 'exploration', polarity: 'positive', importance: 3, experienceId: 'exp:1', created_at: daysAgoIso(1, now) }),
    signal({ id: 's2', key: 'exploration', polarity: 'negative', importance: 3, experienceId: 'exp:2', created_at: daysAgoIso(2, now) })
  ];
  const experiences = [
    experience({ id: 'exp:1', gameId: 'game:a' }),
    experience({ id: 'exp:2', gameId: 'game:b' })
  ];
  const patterns = taste.computePatterns(tasteInput(signals, experiences, now));
  const p = find(patterns, 'exploration');
  assert.strictEqual(p.contradictory, true);
  assert.strictEqual(p.polarity, 'mixed');
  assert.ok(p.supportingGames.includes('Game A'), 'positive game listed');
  assert.ok(p.contradictingGames.includes('Game B'), 'contradicting game listed');
  assert.ok(p.support.some((entry) => entry.polarity === 'positive'));
  assert.ok(p.support.some((entry) => entry.polarity === 'negative'));
});

test('sparse evidence can never read as high confidence', () => {
  const now = new Date().toISOString();
  const single = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(1, now) })
  ], [experience({ id: 'exp:1', gameId: 'game:a' })], now));
  const p = find(single, 'exploration');
  assert.strictEqual(p.frequency, 1);
  assert.ok(p.confidence < 0.35, `confidence ${p.confidence} must stay low`);
  assert.strictEqual(taste.confidenceLabel(p), 'very low evidence');
  assert.notStrictEqual(taste.confidenceLabel(p), 'well supported');
});

test('confidence label thresholds are conservative', () => {
  assert.strictEqual(taste.confidenceLabel({ frequency: 1, confidence: 0.99 }), 'very low evidence');
  assert.strictEqual(taste.confidenceLabel({ frequency: 4, confidence: 0.34 }), 'low confidence');
  assert.strictEqual(taste.confidenceLabel({ frequency: 4, confidence: 0.59 }), 'moderate confidence');
  assert.strictEqual(taste.confidenceLabel({ frequency: 4, confidence: 0.6 }), 'well supported');
});

test('importance is clamped to 1..3', () => {
  const now = new Date().toISOString();
  const patterns = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', importance: 99, created_at: daysAgoIso(1, now) })
  ], [experience({ id: 'exp:1', gameId: 'game:a' })], now));
  const p = find(patterns, 'exploration');
  assert.strictEqual(p.weightedPositive, 3, 'importance clamped to 3');
});

test('emerging requires recency, low frequency and positive net', () => {
  const now = new Date().toISOString();
  const fresh = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(3, now) }),
    signal({ id: 's2', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(5, now) })
  ], [
    experience({ id: 'exp:1', gameId: 'game:a' }),
    experience({ id: 'exp:2', gameId: 'game:b' })
  ], now));
  assert.strictEqual(find(fresh, 'exploration').emerging, true);

  const stale = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(40, now) })
  ], [experience({ id: 'exp:1', gameId: 'game:a' })], now));
  assert.strictEqual(find(stale, 'exploration').emerging, false, 'stale signals are not emerging');
});

test('recentNet tracks only the last 90 days and is null without recent signals', () => {
  const now = new Date().toISOString();
  const patterns = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(200, now) })
  ], [experience({ id: 'exp:1', gameId: 'game:a' })], now));
  const p = find(patterns, 'exploration');
  assert.strictEqual(p.recentNet, null, 'no recent signal → recentNet null');
  assert.ok(p.trend.length === 1 && p.trend[0].month);
});

test('buckets partition patterns and never mix strength levels', () => {
  const now = new Date().toISOString();
  const signals = [
    // strong positive (core via kind)
    signal({ id: 's1', key: 'depth', kind: 'core', polarity: 'positive', importance: 3, created_at: daysAgoIso(1, now) }),
    signal({ id: 's2', key: 'depth', kind: 'core', polarity: 'positive', importance: 3, created_at: daysAgoIso(2, now) }),
    signal({ id: 's3', key: 'depth', kind: 'core', polarity: 'positive', importance: 3, created_at: daysAgoIso(3, now) }),
    // contradictory contextual
    signal({ id: 's4', key: 'exploration', polarity: 'positive', importance: 3, created_at: daysAgoIso(1, now) }),
    signal({ id: 's5', key: 'exploration', polarity: 'negative', importance: 3, created_at: daysAgoIso(2, now) })
  ];
  const experiences = [
    experience({ id: 'exp:1', gameId: 'game:a' }),
    experience({ id: 'exp:2', gameId: 'game:b' }),
    experience({ id: 'exp:3', gameId: 'game:c' })
  ];
  const patterns = taste.computePatterns(tasteInput(signals, experiences, now));
  const b = taste.buckets(patterns);

  const seen = [];
  b.core.forEach((p) => seen.push(p.key));
  b.contextual.forEach((p) => seen.push(p.key));
  assert.strictEqual(seen.length, patterns.length, 'core + contextual = all patterns');
  b.strongPositive.forEach((p) => {
    assert.strictEqual(p.polarity, 'positive');
    assert.ok(['strong', 'moderate'].includes(p.strength));
  });
  b.strongNegative.forEach((p) => {
    assert.strictEqual(p.polarity, 'negative');
    assert.ok(['strong', 'moderate'].includes(p.strength));
  });
  assert.ok(b.contradictions.some((p) => p.key === 'exploration'), 'contradiction bucket contains mixed pattern');
  assert.ok(b.core.some((p) => p.key === 'depth'), 'core kind lands in core bucket');
  assert.ok(b.byGroup, 'grouped contextual sections exist');
});

test('describe() includes label, direction, count and confidence', () => {
  const now = new Date().toISOString();
  const patterns = taste.computePatterns(tasteInput([
    signal({ id: 's1', key: 'exploration', polarity: 'positive', created_at: daysAgoIso(1, now) })
  ], [experience({ id: 'exp:1', gameId: 'game:a' })], now));
  const text = taste.describe(find(patterns, 'exploration'));
  assert.match(text, /Exploration/);
  assert.match(text, /positive/);
  assert.match(text, /1 signal\b/);
  assert.match(text, /very low evidence/);
});

test('patterns sort by evidence score (net × frequency × confidence)', () => {
  const now = new Date().toISOString();
  const signals = [
    signal({ id: 's1', key: 'weak-key', polarity: 'positive', importance: 1, created_at: daysAgoIso(10, now) }),
    signal({ id: 's2', key: 'strong-key', polarity: 'positive', importance: 3, created_at: daysAgoIso(1, now) }),
    signal({ id: 's3', key: 'strong-key', polarity: 'positive', importance: 3, created_at: daysAgoIso(2, now) }),
    signal({ id: 's4', key: 'strong-key', polarity: 'positive', importance: 3, created_at: daysAgoIso(3, now) })
  ];
  const experiences = [
    experience({ id: 'exp:1', gameId: 'game:a' }),
    experience({ id: 'exp:2', gameId: 'game:b' }),
    experience({ id: 'exp:3', gameId: 'game:c' })
  ];
  const patterns = taste.computePatterns(tasteInput(signals, experiences, now));
  assert.strictEqual(patterns[0].key, 'strong-key');
});
