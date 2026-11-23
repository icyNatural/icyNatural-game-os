'use strict';
/**
 * Shared loader + fixtures for Game OS domain tests.
 * Classic scripts are loaded in browser order onto globalThis.GOS.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');

const SCRIPTS = [
  'assets/js/core/util.js',
  'assets/js/data/branch-vocab.js',
  'assets/js/data/seed-graph.js',
  'assets/js/domain/signals.js',
  'assets/js/domain/glyph.js',
  'assets/js/domain/media.js',
  'assets/js/domain/catalog.js',
  'assets/js/domain/lineage.js',
  'assets/js/domain/taste.js',
  'assets/js/domain/recommend.js'
];

let loaded = false;
function load() {
  if (loaded) return globalThis.GOS;
  SCRIPTS.forEach((rel) => require(path.join(ROOT, rel)));
  loaded = true;
  return globalThis.GOS;
}

function seedGraph() {
  load();
  return globalThis.GOS_SEED_GRAPH;
}

/* ------------------------------ taste fixtures ------------------------------ */

function daysAgoIso(days, now) {
  const base = now ? new Date(now).getTime() : Date.now();
  return new Date(base - days * 86400000).toISOString();
}

function signal(over) {
  return Object.assign({
    id: 'sig:test',
    key: 'exploration',
    label: 'Exploration',
    kind: 'contextual',
    polarity: 'positive',
    importance: 2,
    context: 'overall',
    experienceId: 'exp:1',
    gameId: 'game:a',
    evidence: '',
    created_at: new Date().toISOString()
  }, over);
}

function experience(over) {
  return Object.assign({
    id: 'exp:1',
    gameId: 'game:a',
    score: 9,
    platform: 'PC',
    created_at: new Date().toISOString()
  }, over);
}

function tasteInput(signals, experiences, now) {
  const gamesById = {};
  (experiences || []).forEach((exp) => {
    if (!gamesById[exp.gameId]) {
      gamesById[exp.gameId] = { id: exp.gameId, name: 'Game ' + exp.gameId.replace('game:', '').toUpperCase() };
    }
  });
  return { signals, experiences: experiences || [], gamesById, now };
}

/* ---------------------------- recommend fixture ---------------------------- */
/* Mini graph:  games a-f, studio s, mechanic parry, platform pc, franchise f */

function miniGraph() {
  const nodes = [
    { id: 'game:a', type: 'game', name: 'Alpha', metadata: { year: 2019, playability: 'current', modes: ['single'] } },
    { id: 'game:b', type: 'game', name: 'Beta', metadata: { year: 2021, playability: 'current', modes: ['single'] } },
    { id: 'game:c', type: 'game', name: 'Gamma', metadata: { year: 2022, playability: 'current', modes: ['single'] } },
    { id: 'game:d', type: 'game', name: 'Delta', metadata: { year: 2018, playability: 'current', modes: ['single'] } },
    { id: 'game:e', type: 'game', name: 'Epsilon', metadata: { year: 2020, playability: 'current', modes: ['single'] } },
    { id: 'game:f', type: 'game', name: 'Zeta', metadata: { year: 2017, playability: 'current', modes: ['single'] } },
    { id: 'studio:s', type: 'studio', name: 'Studio S' },
    { id: 'mechanic:parry', type: 'mechanic', name: 'Parry' },
    { id: 'platform:pc', type: 'platform', name: 'PC' },
    { id: 'franchise:f', type: 'franchise', name: 'F-series' }
  ];
  const edge = (source, target, relationship_type) => ({
    id: `edge:${source}:${relationship_type}:${target}`,
    source, target, relationship_type,
    confidence_band: 'high', review_status: 'verified'
  });
  const edges = [
    edge('game:b', 'game:a', 'SEQUEL_OF'),
    edge('game:a', 'studio:s', 'DEVELOPED_BY'),
    edge('game:b', 'studio:s', 'DEVELOPED_BY'),
    edge('game:c', 'studio:s', 'DEVELOPED_BY'),
    edge('game:d', 'studio:s', 'DEVELOPED_BY'),
    edge('game:f', 'studio:s', 'DEVELOPED_BY'),
    edge('game:a', 'mechanic:parry', 'USES_MECHANIC'),
    edge('game:b', 'mechanic:parry', 'USES_MECHANIC'),
    edge('game:c', 'mechanic:parry', 'USES_MECHANIC'),
    edge('game:a', 'platform:pc', 'AVAILABLE_ON'),
    edge('game:b', 'platform:pc', 'AVAILABLE_ON'),
    edge('game:a', 'franchise:f', 'MEMBER_OF'),
    edge('game:b', 'franchise:f', 'MEMBER_OF')
  ];
  return { nodes, edges };
}

function miniState(overrides) {
  load();
  const GOS = globalThis.GOS;
  const graph = GOS.lineage.buildGraph(miniGraph(), { nodes: [], edges: [] });
  const state = {
    graph,
    experiences: [
      experience({ id: 'exp:a', gameId: 'game:a', score: 9, platform: 'PC' }),
      experience({ id: 'exp:d', gameId: 'game:d', score: 8, platform: 'PC' })
    ],
    library: [],
    games: [],
    patterns: []
  };
  return Object.assign(state, overrides || {});
}

module.exports = { load, seedGraph, signal, experience, tasteInput, daysAgoIso, miniGraph, miniState, ROOT };
