'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load, ROOT, seedGraph } = require('./helpers');

load();
const VOCAB = globalThis.GOS_VOCAB;
const SEED_PATH = path.join(ROOT, 'assets', 'data', 'seed-graph.json');

const CONFIDENCE_NATIVE_PAIRS = {
  high: ['high', 'confirmed'],
  moderate: ['moderate', 'probable'],
  low: ['low', 'unresolved'],
  speculative: ['speculative', 'tentative', 'suspected'],
  disputed: ['disputed']
};

const LINEAGE_TYPES = new Set(
  VOCAB.relationships.filter((r) => r.lineage).map((r) => r.type)
);

function loadSeed() {
  return JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
}

test('seed graph JSON parses and matches the JS global', () => {
  const seed = loadSeed();
  const js = seedGraph();
  assert.strictEqual(seed.nodes.length, js.nodes.length, 'node counts match');
  assert.strictEqual(seed.edges.length, js.edges.length, 'edge counts match');
  assert.ok(seed.nodes.length >= 200, `seed is substantial (${seed.nodes.length} nodes)`);
  assert.ok(seed.edges.length >= 600, `seed is substantial (${seed.edges.length} edges)`);
});

test('nodes: unique ids, valid types, required fields, no extra keys', () => {
  const seed = loadSeed();
  const ids = new Set();
  const allowedKeys = new Set(['id', 'type', 'name', 'aliases', 'metadata']);
  seed.nodes.forEach((node, i) => {
    assert.ok(node.id && typeof node.id === 'string', `node ${i} has id`);
    assert.ok(!ids.has(node.id), `duplicate node id ${node.id}`);
    ids.add(node.id);
    assert.ok(VOCAB.entityTypes.includes(node.type), `${node.id} type ${node.type} valid`);
    assert.ok(node.name && typeof node.name === 'string', `${node.id} has name`);
    Object.keys(node).forEach((key) => {
      assert.ok(allowedKeys.has(key), `${node.id} has unexpected key ${key}`);
    });
    if (node.aliases) assert.ok(Array.isArray(node.aliases), `${node.id} aliases array`);
  });
  assert.ok(ids.has('game:dark-souls'));
  assert.ok(ids.has('studio:from-software'));
});

test('edges: unique ids, existing endpoints, vocabulary types, no extra keys', () => {
  const seed = loadSeed();
  const nodeIds = new Set(seed.nodes.map((n) => n.id));
  const typeById = Object.fromEntries(seed.nodes.map((n) => [n.id, n.type]));
  const edgeIds = new Set();
  const allowedKeys = new Set([
    'id', 'source', 'target', 'relationship_type', 'confidence_band', 'confidence_native',
    'review_status', 'evidence', 'notes', 'created_at', 'updated_at'
  ]);
  const relTypes = new Set(VOCAB.relationships.map((r) => r.type));

  seed.edges.forEach((edge, i) => {
    assert.ok(edge.id, `edge ${i} has id`);
    assert.ok(!edgeIds.has(edge.id), `duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    assert.ok(relTypes.has(edge.relationship_type), `${edge.id} type ${edge.relationship_type} in vocab`);
    assert.ok(nodeIds.has(edge.source), `${edge.id} source exists`);
    assert.ok(nodeIds.has(edge.target), `${edge.id} target exists`);
    Object.keys(edge).forEach((key) => {
      assert.ok(allowedKeys.has(key), `${edge.id} has unexpected key ${key}`);
    });

    const rel = VOCAB.relationships.find((r) => r.type === edge.relationship_type);
    assert.ok(rel.from.includes(typeById[edge.source]),
      `${edge.id}: ${typeById[edge.source]} allowed as source of ${edge.relationship_type}`);
    assert.ok(rel.to.includes(typeById[edge.target]),
      `${edge.id}: ${typeById[edge.target]} allowed as target of ${edge.relationship_type}`);
  });
});

test('edges: confidence band pairs with native confidence and review status is known', () => {
  const seed = loadSeed();
  seed.edges.forEach((edge) => {
    const band = edge.confidence_band || 'high';
    const native = edge.confidence_native;
    const status = edge.review_status || 'verified';
    const allowed = CONFIDENCE_NATIVE_PAIRS[band];
    assert.ok(allowed, `${edge.id} band ${band} known`);
    if (native !== undefined) {
      assert.strictEqual(typeof native, 'string', `${edge.id} native is a string`);
      assert.ok(allowed.includes(native),
        `${edge.id}: band ${band} cannot pair with native confidence ${native}`);
    }
    assert.ok(VOCAB.reviewStatuses.includes(status), `${edge.id} review status valid`);
  });
});

test('edges: uncertainty always carries evidence, lineage edges are explicit', () => {
  const seed = loadSeed();
  const evidenceText = (edge) => {
    const ev = edge.evidence;
    if (!ev) return '';
    if (typeof ev === 'string') return ev;
    if (Array.isArray(ev)) {
      return ev.map((item) => (typeof item === 'string' ? item : (item && item.text) || '')).join(' ');
    }
    return (ev && ev.text) || '';
  };
  let softCount = 0;
  let lineageCount = 0;
  seed.edges.forEach((edge) => {
    const band = edge.confidence_band || 'high';
    if (band !== 'high') {
      softCount++;
      assert.ok(evidenceText(edge).trim().length > 10,
        `${edge.id} (${band}) carries evidence`);
      assert.notStrictEqual(edge.review_status, 'verified',
        `${edge.id} uncertain band is not marked verified`);
    }
    if (LINEAGE_TYPES.has(edge.relationship_type)) {
      lineageCount++;
      const rel = VOCAB.relationships.find((r) => r.type === edge.relationship_type);
      assert.strictEqual(rel.lineage, true, `${edge.relationship_type} is lineage in vocab`);
      assert.ok(rel.category.endsWith('-lineage'),
        `${edge.relationship_type} uses a *-lineage category, got ${rel.category}`);
    }
  });
  assert.ok(softCount >= 4, `uncertain edges exist (${softCount})`);
  assert.ok(lineageCount >= 20, `lineage edges exist (${lineageCount})`);
});

test('edges: non-lineage categories never claim lineage wording', () => {
  const seed = loadSeed();
  const nonLineage = new Set(['MECHANICALLY_RELATED', 'SPIRITUAL_SUCCESSOR', 'INFLUENCED_BY', 'USES_MECHANIC', 'AVAILABLE_ON']);
  seed.edges.forEach((edge) => {
    if (!nonLineage.has(edge.relationship_type)) return;
    const rel = VOCAB.relationships.find((r) => r.type === edge.relationship_type);
    assert.strictEqual(rel.lineage, false, `${edge.relationship_type} not lineage`);
    assert.ok(!rel.category.endsWith('-lineage'), `${edge.relationship_type} category not lineage`);
  });
});

test('every game connects to at least one mechanic, platform and studio path', () => {
  const seed = loadSeed();
  const games = seed.nodes.filter((n) => n.type === 'game');
  const outTypes = {};
  seed.edges.forEach((edge) => {
    (outTypes[edge.source] = outTypes[edge.source] || []).push(edge.relationship_type);
  });
  let missingPlatform = 0;
  games.forEach((game) => {
    const types = outTypes[game.id] || [];
    assert.ok(types.includes('USES_MECHANIC'), `${game.id} uses at least one mechanic`);
    if (!types.includes('AVAILABLE_ON')) missingPlatform++;
  });
  assert.ok(missingPlatform === 0, `all games have platforms (${missingPlatform} missing)`);
});

test('seed graph builds in the domain layer with full indexes', () => {
  const GOS = globalThis.GOS;
  const graph = GOS.lineage.buildGraph(seedGraph(), { nodes: [], edges: [] });
  assert.strictEqual(graph.stats.nodes, seedGraph().nodes.length);
  assert.strictEqual(graph.stats.edges, seedGraph().edges.length);
  assert.ok(Object.keys(graph.byType).length >= 6, 'all six entity types indexed');
  assert.ok(Object.keys(graph.byMechanic).length >= 20, 'mechanic index populated');
  assert.ok(Object.keys(graph.byStudio).length >= 50, 'studio index populated');
});

const schemaRoot = process.env.BRANCH_SCHEMA_ROOT || path.join(ROOT, '..', 'branch-schema');
const schemaValidator = path.join(schemaRoot, 'scripts', 'validate.ts');
test('branch-schema validator accepts the shipped seed file', {
  skip: !fs.existsSync(schemaValidator) && !process.env.BRANCH_SCHEMA_ROOT
    ? 'Optional private sibling validator is not in the public repository; seed invariants are tested above.'
    : false
}, () => {
  const validator = schemaValidator;
  assert.ok(fs.existsSync(validator), 'configured branch-schema validator present');
  const output = execFileSync(process.execPath, [validator, SEED_PATH], {
    encoding: 'utf8',
    cwd: schemaRoot
  });
  assert.match(output, /valid/i, `validator output: ${output}`);
  assert.match(output, /0 error\(s\)/, `no validator errors: ${output}`);
});
