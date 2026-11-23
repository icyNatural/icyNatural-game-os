'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { load, miniGraph } = require('./helpers');

const GOS = load();
require(path.join(__dirname, '..', 'assets', 'js', 'ui', 'test-ac.js'));

const T = GOS.testAc;

function edge(source, target, relationship_type) {
  return {
    id: `edge:${source}:${relationship_type}:${target}`,
    source,
    target,
    relationship_type,
    confidence_band: 'high',
    review_status: 'verified'
  };
}

function game(id, name, over) {
  return Object.assign({ id, type: 'game', name, aliases: [], metadata: {} }, over || {});
}

function buildCtx(seed, extras) {
  const graph = GOS.lineage.buildGraph(seed, { nodes: [], edges: [] });
  return Object.assign({ graph, experiences: [], library: [], games: [] }, extras || {});
}

const fixture = {
  nodes: [
    game('game:gears-of-war', 'Gears of War', { metadata: { year: 2006 } }),
    game('game:gears-5', 'Gears 5'),
    game('game:vf5', 'Virtua Fighter 5', { aliases: ['VF5'] }),
    game('game:horizon-chase', 'Horizon Chase'),
    game('game:zero-horizon', 'Zero Horizon'),
    { id: 'franchise:gears', type: 'franchise', name: 'Gears of War', aliases: [] },
    { id: 'platform:pc', type: 'platform', name: 'PC', aliases: [] }
  ],
  edges: [
    edge('game:gears-of-war', 'franchise:gears', 'MEMBER_OF'),
    edge('game:gears-5', 'franchise:gears', 'MEMBER_OF'),
    edge('game:gears-of-war', 'platform:pc', 'AVAILABLE_ON')
  ]
};

test('mapPlatform only maps honest form buckets', () => {
  assert.equal(T.mapPlatform('PC'), 'PC');
  assert.equal(T.mapPlatform('PlayStation 5'), 'PS5');
  assert.equal(T.mapPlatform('Xbox Series X|S'), 'Xbox Series');
  assert.equal(T.mapPlatform('Nintendo Switch'), 'Switch');
  assert.equal(T.mapPlatform('Android'), 'Mobile');
  assert.equal(T.mapPlatform('iOS'), 'Mobile');
  assert.equal(T.mapPlatform('GeForce Now'), 'Cloud / Streaming');
  assert.equal(T.mapPlatform('Arcade'), 'Retro');
  assert.equal(T.mapPlatform('Nintendo GameCube'), 'Retro');
  assert.equal(T.mapPlatform('PlayStation 2'), 'Retro');
  assert.equal(T.mapPlatform('PlayStation 3'), null);
  assert.equal(T.mapPlatform('Xbox 360'), null);
  assert.equal(T.mapPlatform(''), null);
  assert.equal(T.mapPlatform(null), null);
});

test('platformSuggestions dedupes and drops unmapped platforms', () => {
  assert.deepEqual(T.platformSuggestions(['PC', 'PlayStation 3', 'Xbox 360']), ['PC']);
  assert.deepEqual(T.platformSuggestions(['Nintendo Switch', 'PC', 'Switch']), ['Switch', 'PC']);
  assert.deepEqual(T.platformSuggestions([]), []);
  assert.equal(T.platformSuggestions(['PC', 'PS5', 'Xbox Series', 'Nintendo Switch', 'Mobile', 'Arcade']).length, 4);
});

test('partial names, aliases and minor typos all match', () => {
  const ctx = buildCtx(fixture);
  const candidates = T.collectCandidates(ctx);

  const partial = T.rankCandidates(candidates, 'gears', 10).map((c) => c.name);
  assert.ok(partial.includes('Gears of War') && partial.includes('Gears 5'), 'partial name matches: ' + JSON.stringify(partial));

  const alias = T.rankCandidates(candidates, 'vf5', 10);
  assert.equal(alias[0].name, 'Virtua Fighter 5', 'alias lookup resolves the canonical title');

  const typo = T.rankCandidates(candidates, 'gears of wr', 10).map((c) => c.name);
  assert.ok(typo.includes('Gears of War'), 'minor typo still matches: ' + JSON.stringify(typo));

  const none = T.rankCandidates(candidates, 'qqqjunkxyzzyqq', 10);
  assert.equal(none.length, 0, 'unrelated queries stay empty so a custom name is offered');
});

test('franchise matches surface member games without hijacking name matches', () => {
  const ctx = buildCtx(miniGraph());
  const candidates = T.collectCandidates(ctx);
  const byFranchise = T.rankCandidates(candidates, 'f-series', 10).map((c) => c.name);
  assert.ok(byFranchise.includes('Alpha') && byFranchise.includes('Beta'), JSON.stringify(byFranchise));
  assert.ok(!byFranchise.includes('Gamma'), 'non-members stay out: ' + JSON.stringify(byFranchise));

  const exact = T.rankCandidates(candidates, 'alpha', 10);
  assert.equal(exact[0].name, 'Alpha', 'exact name beats franchise-derived scores');
});

test('games in the personal library rank above equal intent matches', () => {
  const ctx = buildCtx(fixture, {
    library: [{ id: 'lib:game:zero-horizon', gameId: 'game:zero-horizon', status: 'playing' }]
  });
  const ranked = T.rankCandidates(T.collectCandidates(ctx), 'horizon', 10);
  assert.equal(ranked[0].name, 'Zero Horizon', 'library membership wins over a stronger raw tier');
  assert.equal(T.isOwned(ranked[0]), true);
  assert.equal(T.isOwned(ranked.find((c) => c.name === 'Horizon Chase')), false);
});

test('collectCandidates merges graph, games and played records without duplicates', () => {
  const ctx = buildCtx(fixture, {
    library: [
      { id: 'lib:game:gears-of-war', gameId: 'game:gears-of-war', status: 'completed' },
      { id: 'lib:game:custom', gameId: 'game:custom', status: 'backlog' }
    ],
    experiences: [
      { id: 'exp:1', gameId: 'game:vf5', gameName: 'Virtua Fighter 5' },
      { id: 'exp:2', gameId: 'game:vf5', gameName: 'Virtua Fighter 5' },
      { id: 'exp:3', gameId: 'game:untouched', gameName: 'Untouched Quest' }
    ],
    games: [
      { id: 'game:gears-of-war', name: 'Gears of War', metadata: {} },
      { id: 'game:custom', name: 'My Custom Game', metadata: {} }
    ]
  });
  const candidates = T.collectCandidates(ctx);
  const ids = candidates.map((c) => c.id);
  const names = candidates.map((c) => c.name);

  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids: ' + JSON.stringify(ids));
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'no duplicate names');
  assert.ok(ids.includes('game:custom'), 'custom saved games stay searchable');
  assert.ok(ids.includes('game:untouched'), 'played-but-unsaved games stay searchable');

  const gears = candidates.find((c) => c.id === 'game:gears-of-war');
  assert.equal(gears.libraryStatus, 'completed', 'library status is carried');
  assert.deepEqual(gears.platforms, ['PC'], 'platforms come from AVAILABLE_ON edges');
  assert.deepEqual(gears.franchises, ['Gears of War'], 'franchise names come from MEMBER_OF edges');

  const vf5 = candidates.find((c) => c.id === 'game:vf5');
  assert.equal(vf5.playCount, 2, 'experience count is carried');
  assert.equal(vf5.platforms.length, 0, 'games without platform edges report none');

  const custom = candidates.find((c) => c.id === 'game:custom');
  assert.equal(custom.libraryStatus, 'backlog');
  assert.equal(custom.source, 'library');
});

test('ranked candidates expose known platforms for the suggestion chips', () => {
  const ctx = buildCtx(fixture);
  const ranked = T.rankCandidates(T.collectCandidates(ctx), 'gears', 10);
  assert.deepEqual(T.platformSuggestions(ranked.find((c) => c.name === 'Gears of War').platforms), ['PC']);
  const withoutPlatforms = ranked.find((c) => c.name === 'Gears 5');
  assert.deepEqual(T.platformSuggestions(withoutPlatforms.platforms), [], 'unknown platforms suggest nothing');
});
