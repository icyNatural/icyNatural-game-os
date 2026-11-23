'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load, seedGraph } = require('./helpers');

const GOS = load();
const L = GOS.lineage;
const VOCAB = globalThis.GOS_VOCAB;

function build() {
  return L.buildGraph(seedGraph(), { nodes: [], edges: [] });
}

test('buildGraph merges seed + user graphs with indexes and stats', () => {
  const graph = build();
  assert.ok(graph.stats.nodes >= 200, `nodes ${graph.stats.nodes}`);
  assert.ok(graph.stats.edges >= 600, `edges ${graph.stats.edges}`);
  assert.ok(graph.byId['game:dark-souls'], 'dark souls indexed');
  assert.ok(graph.byKey['fromsoftware'], 'lookup key normalized');

  const someGame = Object.keys(graph.byId).find((id) =>
    graph.byId[id].type === 'game' && id !== 'game:dark-souls');
  const merged = L.buildGraph(seedGraph(), {
    nodes: [{ id: 'game:user-test', type: 'game', name: 'User Added Game' }],
    edges: [{
      id: 'edge:user:test', source: 'game:dark-souls', target: someGame,
      relationship_type: 'SEQUEL_OF', confidence_band: 'high', review_status: 'verified'
    }]
  });
  assert.ok(merged.byId['game:user-test'], 'user node merged');
  assert.strictEqual(merged.stats.nodes, graph.stats.nodes + 1, 'one node added');
  assert.strictEqual(merged.stats.edges, graph.stats.edges + 1, 'one edge added');
});

test('search finds games, studios, mechanics and persons case-insensitively', () => {
  const graph = build();
  const ds = L.search(graph, 'dark souls');
  assert.ok(ds.some((node) => node.id === 'game:dark-souls'), 'game match');

  const from = L.search(graph, 'FROMSoftware');
  assert.ok(from.some((node) => node.id === 'studio:from-software'), 'studio match (case-insensitive)');

  const stealth = L.search(graph, 'stealth');
  assert.ok(stealth.some((node) => node.type === 'mechanic'), 'mechanic match');

  const miyazaki = L.search(graph, 'Miyazaki');
  assert.ok(miyazaki.some((node) => node.type === 'person'), 'person match');

  const nothing = L.search(graph, 'zzzzzz-not-a-thing');
  assert.strictEqual(nothing.length, 0, 'no phantom results');
});

test('firstDegree groups branches by relationship category with labels', () => {
  const graph = build();
  const result = L.firstDegree(graph, 'game:dark-souls', {});
  assert.ok(result, 'result exists');
  assert.strictEqual(result.node.id, 'game:dark-souls');
  assert.ok(result.groups.length >= 2, 'at least two category groups');
  result.groups.forEach((group) => {
    assert.ok(VOCAB.relationshipCategories.includes(group.category) || group.category, 'category key');
    assert.strictEqual(group.label, VOCAB.relationshipCategoryLabels[group.category] || group.category);
    assert.ok(group.items.length >= 1);
    group.items.forEach((item) => {
      assert.ok(item.node && item.node.id, 'item has node');
      assert.ok(item.edge && item.edge.relationship_type, 'item has edge');
      assert.strictEqual(typeof item.reverse, 'boolean');
      assert.strictEqual(item.label, L.labelFor(item.edge, 'game:dark-souls'));
      assert.strictEqual(item.category, L.categoryOf(item.edge.relationship_type));
      assert.strictEqual(item.lineage, L.isLineage(item.edge.relationship_type));
      const notSelf = item.node.id !== 'game:dark-souls' || item.edge.relationship_type !== 'SELF';
      assert.ok(notSelf);
    });
  });
  // lineage flag consistency with vocabulary
  VOCAB.relationships.forEach((rel) => {
    if (rel.category !== 'franchise-lineage') return;
    assert.strictEqual(rel.lineage, true, `${rel.type} flagged lineage`);
  });
});

test('mechanical similarity and analogous design are never presented as lineage', () => {
  const graph = build();
  assert.strictEqual(L.isLineage('MECHANICALLY_RELATED'), false);
  assert.strictEqual(L.isLineage('SPIRITUAL_SUCCESSOR'), false);
  assert.strictEqual(L.isLineage('INFLUENCED_BY'), false);
  assert.strictEqual(L.isLineage('USES_MECHANIC'), false);
  assert.strictEqual(L.isLineage('AVAILABLE_ON'), false);
  assert.strictEqual(L.isLineage('SEQUEL_OF'), true);
  assert.strictEqual(L.isLineage('STUDIO_DESCENDANT'), true);
  assert.strictEqual(L.isLineage('LEFT_TO_FOUND'), true);
  assert.strictEqual(L.labelFor({ relationship_type: 'MECHANICALLY_RELATED' }, 'x'), 'mechanically related to');
});

test('lineageTypes filter narrows first degree to the selected categories', () => {
  const graph = build();
  const all = L.firstDegree(graph, 'game:dark-souls', {});
  const filtered = L.firstDegree(graph, 'game:dark-souls', {
    filters: { lineageTypes: ['franchise-lineage'] }
  });
  assert.ok(filtered.groups.length <= all.groups.length);
  filtered.groups.forEach((group) => assert.strictEqual(group.category, 'franchise-lineage'));
  filtered.groups.forEach((group) => group.items.forEach((item) => {
    assert.strictEqual(L.categoryOf(item.edge.relationship_type), 'franchise-lineage');
  }));
});

test('mechanic filter keeps only games that actually use the mechanic', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  const stealthId = Object.keys(graph.byId).find((id) => graph.byId[id].name === 'stealth');
  assert.ok(stealthId, 'stealth mechanic exists in seed');

  const all = L.firstDegree(graph, 'studio:arkane', {
    filters: { mechanic: stealthId },
    context: ctx
  });
  const gameItems = [];
  all.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'game') gameItems.push(item);
  }));
  assert.ok(gameItems.length >= 1, 'at least one stealth game under Arkane');
  gameItems.forEach((item) => {
    const uses = (graph.out[item.node.id] || []).some((edge) =>
      edge.relationship_type === 'USES_MECHANIC' && edge.target === stealthId);
    const usedIn = (graph.in[item.node.id] || []).some((edge) =>
      edge.relationship_type === 'USES_MECHANIC' && edge.source === stealthId);
    assert.ok(uses || usedIn, `${item.node.name} really uses stealth`);
  });

  // unfiltered view contains a non-stealth Arkane game → the filter is doing work
  const unfiltered = L.firstDegree(graph, 'studio:arkane', { context: ctx });
  const unfilteredGames = [];
  unfiltered.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'game') unfilteredGames.push(item.node.id);
  }));
  assert.ok(unfilteredGames.length > gameItems.length, 'filter narrows the game set');
});

function gameNodesOf(result) {
  const out = [];
  result.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'game') out.push(item.node);
  }));
  return out;
}

function directNeighbors(graph, gameId) {
  const set = new Set();
  (graph.out[gameId] || []).forEach((edge) => set.add(edge.target));
  (graph.in[gameId] || []).forEach((edge) => set.add(edge.source));
  return set;
}

test('person filter keeps only games directly connected to that person', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  const filtered = gameNodesOf(L.firstDegree(graph, 'studio:from-software', {
    filters: { person: 'person:hidetaka-miyazaki' }, context: ctx
  }));
  assert.ok(filtered.length >= 4, `Miyazaki games under FromSoftware (${filtered.length})`);
  filtered.forEach((game) => {
    assert.ok(directNeighbors(graph, game.id).has('person:hidetaka-miyazaki'),
      `${game.name} is directly connected to Miyazaki`);
  });
  const ids = filtered.map((g) => g.id);
  assert.ok(!ids.includes('game:dark-souls-2'), 'unrelated game excluded by person filter');
  assert.ok(!ids.includes('game:dark-souls-3'), 'unrelated game excluded by person filter');

  const unfiltered = gameNodesOf(L.firstDegree(graph, 'studio:from-software', { context: ctx }));
  assert.ok(unfiltered.length > filtered.length, 'person filter narrows the set');
});

test('studio filter keeps only games and studios that actually connect', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  const result = L.firstDegree(graph, 'game:dark-souls', {
    filters: { studio: 'studio:from-software' }, context: ctx
  });
  const studios = [];
  result.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'studio') studios.push(item.node);
  }));
  assert.ok(studios.some((s) => s.id === 'studio:from-software'), 'FromSoftware shown');
  assert.ok(!studios.some((s) => s.id === 'studio:bandai-namco'),
    'other publisher hidden — direct connection required');

  gameNodesOf(result).forEach((game) => {
    assert.ok(directNeighbors(graph, game.id).has('studio:from-software'),
      `${game.name} developed/published by FromSoftware`);
  });
});

test('franchise filter narrows to the requested franchise', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  const result = L.firstDegree(graph, 'game:dark-souls', {
    filters: { franchise: 'franchise:dark-souls' }, context: ctx
  });
  const franchises = [];
  result.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'franchise') franchises.push(item.node);
  }));
  assert.strictEqual(franchises.length, 1, 'only the Dark Souls franchise node');
  assert.strictEqual(franchises[0].id, 'franchise:dark-souls');
  const games = gameNodesOf(result);
  assert.ok(games.length >= 1, 'sequels visible under the same franchise');
  games.forEach((game) => {
    assert.ok(directNeighbors(graph, game.id).has('franchise:dark-souls'),
      `${game.name} belongs to franchise:dark-souls`);
  });
});

test('platform filter shows only matching platforms and PC-available games', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  const result = L.firstDegree(graph, 'game:dark-souls', {
    filters: { platforms: ['PC'] }, context: ctx
  });
  const platforms = [];
  result.groups.forEach((group) => group.items.forEach((item) => {
    if (item.node.type === 'platform') platforms.push(item.node);
  }));
  assert.ok(platforms.length >= 1, 'PC shown');
  platforms.forEach((platform) => {
    assert.ok(/pc/i.test(platform.name) || platform.id === 'platform:pc',
      `unexpected platform ${platform.name}`);
  });
  gameNodesOf(result).forEach((game) => {
    assert.ok(directNeighbors(graph, game.id).has('platform:pc'),
      `${game.name} is available on PC`);
  });
});

test('relationship filters never let similarity/availability impersonate each other', () => {
  const graph = build();
  const ctx = { graph, libraryByGame: {} };
  // mechanic filter: games must share the mechanic, similarity edges cannot help
  const stealthId = 'mechanic:stealth';
  const mechanicallyRelatedNeighbors = [];
  Object.keys(graph.byId).forEach((id) => {
    (graph.out[id] || []).forEach((edge) => {
      if (edge.relationship_type === 'MECHANICALLY_RELATED' && edge.target !== id) {
        mechanicallyRelatedNeighbors.push([edge.source, edge.target]);
      }
    });
  });
  assert.ok(mechanicallyRelatedNeighbors.length >= 1, 'seed has similarity edges to test against');

  const thief = graph.byId['game:thief-the-dark-project'];
  assert.ok(thief, 'thief exists');
  const result = gameNodesOf(L.firstDegree(graph, 'game:thief-the-dark-project', {
    filters: { mechanic: stealthId }, context: ctx
  }));
  result.forEach((game) => {
    assert.ok(directNeighbors(graph, game.id).has(stealthId),
      `${game.name} passes only via a direct USES_MECHANIC edge`);
  });
});

test('expand is depth-bounded (cap 3) and cycle-safe with a node budget', () => {
  const graph = build();
  const one = L.expand(graph, ['game:dark-souls'], { depth: 1 });
  assert.ok(one.depth === 1);
  assert.ok(one.nodes.length < graph.stats.nodes, 'depth 1 is a subset');

  const two = L.expand(graph, ['game:dark-souls'], { depth: 2 });
  assert.ok(two.nodes.length >= one.nodes.length, 'deeper expands further');
  Object.values(two.paths).forEach((path) => {
    assert.ok(path.length <= 3, `path length ${path.length} within depth 2 (+root)`);
  });

  const capped = L.expand(graph, ['game:dark-souls'], { depth: 99 });
  assert.strictEqual(capped.depth, L.MAX_DEPTH, 'depth capped at MAX_DEPTH');
  assert.ok(capped.depth <= 3, 'MAX_DEPTH is 3');

  const budgeted = L.expand(graph, ['game:dark-souls'], { depth: 3, nodeBudget: 10 });
  assert.ok(budgeted.nodes.length <= 10 + 1, 'node budget respected');

  const ids = new Set(capped.nodes.map((n) => n.id));
  assert.strictEqual(ids.size, capped.nodes.length, 'no duplicate nodes (cycle safe)');
});

test('pathsFrom walks allowed edge types only and returns seed→target hops', () => {
  const graph = build();
  const paths = L.pathsFrom(graph, ['game:dark-souls'], {
    depth: 3, minDepth: 1, maxPaths: 500,
    edgeTypes: GOS.recommend.PATH_EDGE_TYPES,
    targetFilter: (node) => node.type === 'game'
  });
  assert.ok(paths.length >= 1, 'seed walks produce paths');
  paths.forEach((path) => {
    assert.strictEqual(path.seedId, 'game:dark-souls');
    assert.ok(path.hops.length >= 1 && path.hops.length <= 3, 'hop count bounded');
    assert.strictEqual(path.depth, path.hops.length);
    path.hops.forEach((hop) => {
      assert.ok(GOS.recommend.PATH_EDGE_TYPES.includes(hop.edge.relationship_type),
        `${hop.edge.relationship_type} is an allowed path edge`);
      assert.ok(hop.label && hop.label.length > 0, 'hop carries a readable label');
      assert.ok(hop.category, 'hop carries a category');
    });
    const last = path.hops[path.hops.length - 1];
    assert.strictEqual(last.node.id, path.targetId, 'targetId is the last hop node');
    assert.strictEqual(last.node.type, 'game', 'targets are games');
    assert.notStrictEqual(path.targetId, 'game:dark-souls', 'seed is not its own target');
  });
});

test('edgePasses/entityPasses never let availability masquerade as lineage', () => {
  const graph = build();
  assert.ok(!L.edgePasses({ relationship_type: 'AVAILABLE_ON' }, { lineageTypes: ['franchise-lineage'] }));
  assert.ok(!L.edgePasses({ relationship_type: 'USES_MECHANIC' }, { lineageTypes: ['studio-lineage'] }));
  assert.ok(L.edgePasses({ relationship_type: 'SEQUEL_OF' }, { lineageTypes: ['franchise-lineage'] }));
  assert.ok(L.edgePasses({ relationship_type: 'SEQUEL_OF' }, null), 'no filter passes everything');
});

test('labelFor renders direction-aware readable labels', () => {
  const graph = build();
  const seq = { relationship_type: 'SEQUEL_OF' };
  assert.ok(['sequel of', 'has sequel'].includes(L.labelFor(seq, 'a')));
  const mech = { relationship_type: 'MECHANICALLY_RELATED' };
  assert.strictEqual(L.labelFor(mech, 'a'), 'mechanically related to');
  const cred = { relationship_type: 'DEVELOPED_BY' };
  assert.ok(['developed by', 'developed'].includes(L.labelFor(cred, 'a')));
});
