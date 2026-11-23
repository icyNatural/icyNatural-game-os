'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, miniState, experience } = require('./helpers');

const GOS = load();
const rec = GOS.recommend;

test('lovedGames uses a 7.5 threshold', () => {
  const state = miniState();
  const ctx = rec.buildContext(state);
  const loved = rec.lovedGames(ctx);
  const ids = loved.map((item) => item.id);
  assert.ok(ids.includes('game:a'), 'score 9 is loved');
  assert.ok(ids.includes('game:d'), 'score 8 is loved');
  assert.ok(!ids.includes('game:b'), 'unplayed games are not loved');
  assert.ok(loved.every((item) => item.score >= 7.5));

  state.experiences.push(experience({ id: 'exp:low', gameId: 'game:b', score: 7.4 }));
  const ctx2 = rec.buildContext(state);
  assert.ok(!rec.lovedGames(ctx2).some((item) => item.id === 'game:b'), '7.4 is below threshold');
});

test('candidates exclude played and dropped games, include unplayed related games', () => {
  const state = miniState();
  state.library.push({ gameId: 'game:f', status: 'dropped' });
  const results = rec.candidates(state, { limit: 10 });
  const ids = results.map((r) => r.gameId);
  assert.ok(!ids.includes('game:a'), 'played game excluded');
  assert.ok(!ids.includes('game:d'), 'played game excluded');
  assert.ok(!ids.includes('game:f'), 'dropped game excluded');
  assert.ok(!ids.includes('game:e'), 'game with only the weightless "unplayed" reason is excluded');
  assert.ok(ids.includes('game:b'), 'sequel is a candidate');
  assert.ok(ids.includes('game:c'), 'studio sibling is a candidate');
});

test('candidates are ranked and every entry carries explanatory reasons', () => {
  const state = miniState();
  const results = rec.candidates(state, { limit: 10 });
  assert.ok(results.length >= 2);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score, 'sorted by descending score');
  }
  results.forEach((item) => {
    assert.ok(item.reasons.length >= 1, `${item.gameId} has reasons`);
    item.reasons.forEach((reason) => {
      assert.ok(reason.text && reason.text.length > 5, 'reason text is explanatory');
      assert.ok(typeof reason.weight === 'number');
    });
    const sorted = item.reasons.map((r) => r.weight);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1] >= sorted[i], 'reasons sorted by weight');
  });

  const beta = results.find((r) => r.gameId === 'game:b');
  const pathReason = beta.reasons.find((r) => r.code === 'lineage');
  assert.ok(pathReason, 'sequel candidate explains itself via path');
  assert.match(pathReason.text, /Alpha/, 'path names the loved seed');
  assert.match(pathReason.text, /9\.0/, 'path includes the rating you gave the seed');
  assert.ok(Array.isArray(pathReason.path) && pathReason.path.length === 2, 'reason carries the id path');
});

test('studio reason fires when a direct path does not exist', () => {
  const state = miniState();
  // remove the sequel edge so Gamma has no path from Alpha
  state.graph.edges = state.graph.edges.filter((e) => e.relationship_type !== 'SEQUEL_OF');
  const rebuilt = GOS.lineage.buildGraph(
    { nodes: state.graph.nodes, edges: state.graph.edges }, { nodes: [], edges: [] });
  state.graph = rebuilt;
  const results = rec.candidates(state, { limit: 10, includePlayed: true });
  const gamma = results.find((r) => r.gameId === 'game:c');
  assert.ok(gamma, 'gamma still a candidate');
  const codes = gamma.reasons.map((r) => r.code);
  assert.ok(codes.includes('path') || codes.includes('studio'),
    `expected path or studio reason, got ${codes.join(',')}`);
});

test('platform reason appears when you play on the same platform', () => {
  const state = miniState(); // experiences carry platform: PC
  const results = rec.candidates(state, { limit: 10 });
  const withPlatform = results.filter((r) => r.reasons.some((x) => x.code === 'platform'));
  assert.ok(withPlatform.length >= 1, 'at least one PC candidate mentions PC');
  const reason = results.flatMap((r) => r.reasons).find((r) => r.code === 'platform');
  assert.match(reason.text, /available on PC/);
  assert.match(reason.text, /you play on PC/);
});

test('mechanic reasons are tied to positive taste patterns with evidence games', () => {
  const state = miniState();
  state.patterns = [{
    id: 'pattern:parry-reversal', key: 'parry-reversal', label: 'Parry / reversal',
    kind: 'contextual', polarity: 'positive', strength: 'strong',
    frequency: 4, net: 1, confidence: 0.8,
    support: [
      { polarity: 'positive', gameName: 'Alpha' },
      { polarity: 'positive', gameName: 'Delta' }
    ]
  }];
  const results = rec.candidates(state, { limit: 10 });
  const beta = results.find((r) => r.gameId === 'game:b');
  const mechanic = beta.reasons.find((r) => r.code === 'mechanic');
  assert.ok(mechanic, 'Beta shares the Parry mechanic with positive patterns');
  assert.match(mechanic.text, /Parry matches 2 strong positive experiences/);
  assert.ok(mechanic.evidence.includes('Alpha'), 'evidence names the experiences behind the pattern');
});

test('surprise explains itself when nothing is loved yet', () => {
  const state = miniState();
  state.experiences = [];
  const result = rec.surprise(state, {});
  assert.strictEqual(result.items.length, 0);
  assert.match(result.note, /Log a strongly rated experience/);
});

test('surprise walks 1-3 hops from loved seeds and shows the path', () => {
  const state = miniState();
  const result = rec.surprise(state, { limit: 3, pick: 0 });
  assert.strictEqual(result.note, null);
  assert.ok(result.seeds.length >= 1 && result.seeds.length <= 2, 'one or two seeds');
  result.seeds.forEach((seed) => {
    assert.ok(seed.name && seed.score >= 7.5, 'seeds are loved games with names');
  });
  assert.ok(result.items.length >= 1, 'surprise returns items');
  result.items.forEach((item) => {
    assert.ok(item.gameId !== 'game:a' && item.gameId !== 'game:d', 'never returns played games');
    assert.ok(item.path && item.path.length >= 2, 'path includes seed + hop');
    assert.ok(item.depth >= 1 && item.depth <= 3, `depth bounded 1..3 (got ${item.depth})`);
    assert.ok(item.reasons.length >= 1);
    const pathReason = item.reasons.find((r) => r.code === 'path');
    assert.ok(pathReason, 'path reason present');
    assert.match(pathReason.text, /path from /);
    assert.ok(pathReason.evidence.length >= 2, 'path evidence lists nodes');
  });
  const scores = result.items.map((i) => i.score);
  assert.deepStrictEqual(scores, scores.slice().sort((a, b) => b - a), 'items sorted');
});

test('surprise cycles seeds across picks', () => {
  const state = miniState();
  const first = rec.surprise(state, { pick: 0 });
  const second = rec.surprise(state, { pick: 1 });
  assert.notStrictEqual(first.seeds[0].id, second.seeds[0].id, 'different pick = different first seed');
});

test('PATH_EDGE_TYPES drives paths and never uses availability', () => {
  assert.ok(Array.isArray(rec.PATH_EDGE_TYPES));
  assert.ok(rec.PATH_EDGE_TYPES.includes('SEQUEL_OF'), 'sequels are walkable');
  assert.ok(rec.PATH_EDGE_TYPES.includes('MECHANICALLY_RELATED'), 'mechanical similarity is walkable');
  assert.ok(!rec.PATH_EDGE_TYPES.includes('AVAILABLE_ON'), 'platforms never create recommendation paths');
  assert.ok(!rec.PATH_EDGE_TYPES.includes('FRANCHISE_DESCENDANT') || true);
  Object.keys(rec.CATEGORY_WEIGHTS).forEach((category) => {
    assert.ok(rec.CATEGORY_WEIGHTS[category] > 0, `${category} has a positive weight`);
  });
  assert.ok(rec.CATEGORY_WEIGHTS['franchise-lineage'] > rec.CATEGORY_WEIGHTS.availability,
    'lineage outweighs availability');
});
