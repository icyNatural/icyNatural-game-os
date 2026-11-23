'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { load } = require('./helpers');
load();
require(path.join(__dirname, '..', 'assets', 'js', 'domain', 'glyph.js'));
const E = globalThis.GOS.glyphEngine;

const scores = { control: 10, clarity: 9, freedom: 8, expression: 7, engagement: 6, depth: 5, flow: 4, intensity: 3, replay: 2 };

test('glyph geometry is deterministic', () => {
  assert.deepStrictEqual(E.geometry(scores), E.geometry({ ...scores }));
});

test('radar geometry is one filled nine-vertex polygon on the fixed 0–10 scale', () => {
  const geometry = E.geometry(scores, { variant: 'session' });
  assert.strictEqual(geometry.version, 3);
  assert.strictEqual(geometry.chart, 'radar');
  assert.strictEqual(geometry.points.length, 9);
  assert.strictEqual(geometry.polygon.split(' ').length, 9, 'no smoothing, spikes or extra vertices');
  assert.strictEqual(geometry.scale.min, 0);
  assert.strictEqual(geometry.scale.max, 10);
  assert.strictEqual(geometry.points[0].radius, 84, 'score 10 reaches the fixed outer ring');
  assert.strictEqual(geometry.points[8].radius, 16.8, 'score 2 sits at 20% of the fixed radius');
});

test('every axis uses the same radius formula with no per-glyph normalisation', () => {
  const geometry = E.geometry(scores);
  geometry.points.forEach((point, index) => {
    const key = E.DIMENSIONS[index].key;
    assert.strictEqual(point.radius, Math.round(scores[key] / 10 * E.RADAR.outerRadius * 1000) / 1000);
  });
});

test('fixed reference rings are shared nine-sided 0–10 guides', () => {
  const geometry = E.geometry(scores);
  assert.deepStrictEqual(geometry.rings.map((ring) => ring.score), [2, 4, 6, 8, 10]);
  assert.strictEqual(geometry.rings[4].radius, E.RADAR.outerRadius);
  assert.ok(geometry.rings.every((ring) => ring.polygon.split(' ').length === 9));
  assert.strictEqual(geometry.spokes.length, 9);
});

test('high scores reach the outer ring and low scores pull inward', () => {
  const high = E.geometry({ control: 10, clarity: 10, freedom: 10, expression: 10, engagement: 10, depth: 10, flow: 10, intensity: 10, replay: 10 });
  const low = E.geometry({ control: 3, clarity: 3, freedom: 3, expression: 3, engagement: 3, depth: 3, flow: 3, intensity: 3, replay: 3 });
  assert.ok(high.points.every((point) => point.radius === 84));
  assert.ok(low.points.every((point) => point.radius === 25.2));
});

test('contrasting profiles create visibly different deterministic silhouettes', () => {
  const profiles = [
    { control: 10, clarity: 10, freedom: 10, expression: 10, engagement: 10, depth: 10, flow: 10, intensity: 10, replay: 10 },
    { control: 10, clarity: 8, freedom: 9, expression: 8, engagement: 8, depth: 2, flow: 10, intensity: 9, replay: 7 },
    { control: 5, clarity: 7, freedom: 9, expression: 8, engagement: 8, depth: 10, flow: 6, intensity: 2, replay: 7 },
    { control: 10, clarity: 3, freedom: 8, expression: 2, engagement: 9, depth: 5, flow: 10, intensity: 4, replay: 7 }
  ];
  const silhouettes = profiles.map((profile) => E.geometry(profile).polygon);
  assert.strictEqual(new Set(silhouettes).size, 4);
});

test('session, game and taste glyphs share one renderer and one scale', () => {
  const session = E.geometry(scores, { variant: 'session', sampleCount: 1 });
  const game = E.geometry(scores, { variant: 'game', sampleCount: 4 });
  const taste = E.geometry(scores, { variant: 'taste', sampleCount: 12, distinctGames: 6 });
  assert.deepStrictEqual(session.points.map((point) => point.radius), game.points.map((point) => point.radius));
  assert.deepStrictEqual(game.points.map((point) => point.radius), taste.points.map((point) => point.radius));
  assert.strictEqual(session.polygon, game.polygon);
  assert.strictEqual(game.polygon, taste.polygon);
  assert.strictEqual(session.variant, 'session');
  assert.strictEqual(game.variant, 'game');
  assert.strictEqual(taste.variant, 'taste');
});

test('score values are clamped to 1..10 and missing dimensions use neutral fallback', () => {
  const normalized = E.normalizeScores({ control: 99, clarity: -4, freedom: null });
  assert.strictEqual(normalized.values.control, 10);
  assert.strictEqual(normalized.values.clarity, 1);
  assert.strictEqual(normalized.values.freedom, 5);
  assert.ok(normalized.missing.includes('freedom'));
});

test('session glyph preserves one experience and its signals', () => {
  const session = E.session({ id: 'exp:1', gameId: 'game:a', scores, score: 7 }, [{ experienceId: 'exp:1', key: 'movement-feel' }]);
  assert.strictEqual(session.sampleCount, 1);
  assert.strictEqual(session.signals.length, 1);
});

test('game aggregate equally weights recorded sessions', () => {
  const result = E.aggregateGame([
    { id: '1', gameId: 'game:a', scores: { ...scores, control: 10 }, score: 9 },
    { id: '2', gameId: 'game:a', scores: { ...scores, control: 2 }, score: 5 }
  ], 'game:a');
  assert.strictEqual(result.scores.control, 6);
  assert.strictEqual(result.score, 7);
  assert.strictEqual(result.sampleCount, 2);
});

test('taste aggregate weights games rather than allowing session-heavy games to dominate', () => {
  const experiences = [
    { id: '1', gameId: 'game:a', scores: { ...scores, control: 10 } },
    { id: '2', gameId: 'game:a', scores: { ...scores, control: 10 } },
    { id: '3', gameId: 'game:b', scores: { ...scores, control: 2 } }
  ];
  const result = E.aggregateTaste(experiences);
  assert.strictEqual(result.scores.control, 6);
  assert.strictEqual(result.distinctGames, 2);
});

test('taste interpretation uses real game aggregates and separates positive ratings from all played games', () => {
  const experiences = [
    { id: 'a1', gameId: 'game:a', gameName: 'Alpha', scores: { ...scores, control: 10, intensity: 4 }, score: 9 },
    { id: 'a2', gameId: 'game:a', gameName: 'Alpha', scores: { ...scores, control: 8, intensity: 6 }, score: 8 },
    { id: 'b1', gameId: 'game:b', gameName: 'Beta', scores: { ...scores, control: 8, intensity: 4 }, score: 8 },
    { id: 'c1', gameId: 'game:c', gameName: 'Gamma', scores: { ...scores, control: 2, intensity: 10 }, score: 4 }
  ];
  const analysis = E.analyzeTaste(experiences, {
    'game:a': { name: 'Alpha' }, 'game:b': { name: 'Beta' }, 'game:c': { name: 'Gamma' }
  });
  assert.strictEqual(analysis.overall.scores.control, 6.33);
  assert.strictEqual(analysis.positive.scores.control, 8.5);
  assert.strictEqual(analysis.positiveGameCount, 2);
  assert.strictEqual(analysis.positiveExperienceCount, 3);
  assert.strictEqual(analysis.preferenceEvidenceSufficient, true);
  assert.strictEqual(analysis.dimensions.length, 9);
  assert.strictEqual(analysis.dimensions[0].direction, '12 o’clock · up');
  assert.ok(analysis.patterns.some((pattern) => pattern.key === 'control'));
  const control = analysis.patterns.find((pattern) => pattern.key === 'control');
  assert.ok(control.supporting.some((game) => game.gameName === 'Alpha'));
  assert.ok(control.contrasting.some((game) => game.gameName === 'Gamma'));
});

test('positive taste profile threshold is explicit and sparse evidence is acknowledged', () => {
  const experiences = [
    { id: 'a1', gameId: 'game:a', scores, score: 7.5 },
    { id: 'b1', gameId: 'game:b', scores: { ...scores, control: 1 }, score: 7.4 }
  ];
  const analysis = E.analyzeTaste(experiences, {});
  assert.strictEqual(E.POSITIVE_EXPERIENCE_THRESHOLD, 7.5);
  assert.strictEqual(analysis.positiveGameCount, 1);
  assert.strictEqual(analysis.preferenceEvidenceSufficient, false);
  assert.strictEqual(analysis.patterns.length, 0);
  assert.match(analysis.positiveRule, /7\.5\/10/);
});

test('signal ornament mapping is separate and deterministic', () => {
  const mapped = E.ornamentMap([{ key: 'parry-reversal', polarity: 'positive' }, { key: 'movement-feel', polarity: 'negative' }]);
  assert.deepStrictEqual(mapped.map((item) => item.type), ['mirrored-cuts', 'sweep']);
});

test('similarity exposes shared dimensions, differences and evidence', () => {
  const left = { scores, sampleCount: 2 };
  const right = { scores: { ...scores, control: 1 }, sampleCount: 3 };
  const result = E.similarity(left, right);
  assert.strictEqual(result.calculable, true);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.strictEqual(result.differences[0].key, 'control');
  assert.deepStrictEqual(result.evidence, { left: 2, right: 3 });
});

test('similarity never invents evidence for unreviewed games', () => {
  const result = E.similarity({ scores, sampleCount: 1 }, { scores, sampleCount: 0 });
  assert.strictEqual(result.calculable, false);
  assert.strictEqual(result.score, null);
  assert.strictEqual(result.reason, 'insufficient-evidence');
});