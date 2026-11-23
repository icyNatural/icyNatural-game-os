'use strict';
/**
 * Catalog adapter tests: local fuzzy search honesty, RAWG normalization,
 * duplicate prevention and the local-first TTL cache.
 */
const test = require('node:test');
const assert = require('node:assert');
const { load, seedGraph } = require('./helpers');

const GOS = load();
const C = GOS.catalog;
const L = GOS.lineage;

/* ------------------------------ fake store ------------------------------- */

function fakeStore(seed) {
  const map = new Map((seed || []).map((record) => [record.id, record]));
  return {
    get: (collection, id) => Promise.resolve(collection === 'catalogCache' ? (map.get(id) || null) : null),
    put: (collection, record) => { map.set(record.id, record); return Promise.resolve(record); },
    _map: map
  };
}

/* ------------------------------- scoring --------------------------------- */

test('scoreText: exact, prefix and substring beats fuzzy', () => {
  const exact = C.scoreText('dark souls', 'Dark Souls');
  const prefix = C.scoreText('dark', 'Dark Souls');
  const fuzzy = C.scoreText('drak souls', 'Dark Souls');
  assert.ok(exact > prefix, 'exact outranks prefix');
  assert.ok(prefix > fuzzy, 'prefix outranks fuzzy');
  assert.ok(fuzzy > 0, 'typo still matches');
});

test('scoreText: nonsense queries never match (no phantom results)', () => {
  const graph = L.buildGraph(seedGraph(), { nodes: [], edges: [] });
  ['zzzzzz-not-a-thing', 'qwertyuiop', 'xkcdz', '!!!'].forEach((query) => {
    const hits = C.localSearch(graph.nodes, query, 20);
    assert.strictEqual(hits.length, 0, `"${query}" returns nothing`);
  });
});

test('scoreText: short fragments ("a", "of") do not match everything', () => {
  const graph = L.buildGraph(seedGraph(), { nodes: [], edges: [] });
  const hits = C.localSearch(graph.nodes, 'a', 20);
  assert.strictEqual(hits.length, 0, 'single letter returns nothing');
});

test('localSearch: dedupes by id, respects limit, sorts by score', () => {
  const games = [
    { id: 'game:a', name: 'Dark Souls' },
    { id: 'game:a', name: 'Dark Souls' },
    { id: 'game:b', name: 'Dark Souls II' },
    { id: 'game:c', name: 'Hades' }
  ];
  const rows = C.localSearch(games, 'dark souls', 10);
  assert.strictEqual(rows.length, 2, 'duplicate id collapsed');
  assert.strictEqual(rows[0].id, 'game:a', 'exact match first');
  const limited = C.localSearch(games, 'dark', 1);
  assert.strictEqual(limited.length, 1, 'limit respected');
});

test('localSearch: also matches aliases, franchises and developers', () => {
  const games = [{
    id: 'game:eday',
    name: 'Gears of War: E-Day',
    aliases: ['E-Day'],
    metadata: { developers: ['The Coalition'], franchises: ['Gears of War'] }
  }];
  assert.ok(C.localSearch(games, 'e-day', 5).some((g) => g.id === 'game:eday'), 'alias matches');
  assert.ok(C.localSearch(games, 'coalition', 5).some((g) => g.id === 'game:eday'), 'developer matches');
  assert.ok(C.localSearch(games, 'gears of war', 5).some((g) => g.id === 'game:eday'), 'franchise matches');
});

/* --------------------------- RAWG normalization -------------------------- */

test('normalizeRawg: builds a catalog game node with source metadata', () => {
  const node = C.normalizeRawg({
    id: 12345,
    name: 'Gears of War: E-Day',
    slug: 'gears-of-war-e-day',
    released: '2026-08-01',
    background_image: 'https://example.test/cover.jpg',
    platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'Xbox Series X|S' } }],
    developers: [{ name: 'The Coalition' }]
  });
  assert.strictEqual(node.id, 'game:rawg:12345');
  assert.strictEqual(node.type, 'game');
  assert.strictEqual(node.name, 'Gears of War: E-Day');
  assert.strictEqual(node.externalIds.rawg, '12345');
  assert.strictEqual(node.metadata.source, 'rawg');
  assert.strictEqual(node.metadata.year, 2026);
  assert.strictEqual(node.metadata.developers[0], 'The Coalition');
  assert.ok(node.metadata.platforms.includes('PC'));
  assert.strictEqual(node.metadata.cover, 'https://example.test/cover.jpg');
});

test('releaseStatus: past dates are released, future dates are upcoming', () => {
  const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
  assert.strictEqual(C.releaseStatus(past), 'released');
  assert.strictEqual(C.releaseStatus(future), 'upcoming');
  assert.strictEqual(C.releaseStatus(null), 'unknown');
  assert.strictEqual(C.releaseStatus('not-a-date'), 'unknown');
});

/* ------------------------ duplicate prevention --------------------------- */

test('canonicalMatch: matches by RAWG id and by canonical name', () => {
  const existing = [
    { id: 'game:rawg:12345', name: 'Gears of War: E-Day', externalIds: { rawg: '12345' } },
    { id: 'game:hades', name: 'Hades' }
  ];
  assert.strictEqual(
    C.canonicalMatch(existing, { name: 'Something Else', externalIds: { rawg: '12345' } }).id,
    'game:rawg:12345', 'rawg id match');
  assert.strictEqual(
    C.canonicalMatch(existing, { name: 'hades' }).id,
    'game:hades', 'name match (case-insensitive)');
  assert.strictEqual(C.canonicalMatch(existing, { name: 'Disco Elysium' }), null, 'no false match');
});

test('dedupe: keeps the first occurrence of a duplicate', () => {
  const out = C.dedupe([
    { id: 'game:a', name: 'Hades' },
    { id: 'game:rawg:9', name: 'Hades', externalIds: { rawg: '9' } },
    { id: 'game:b', name: 'Celeste' }
  ]);
  assert.deepStrictEqual(out.map((g) => g.id), ['game:a', 'game:b']);
});

/* ----------------------------- TTL cache --------------------------------- */

test('cache: write then read returns fresh games; stale entries are ignored', async () => {
  const store = fakeStore();
  const games = [C.normalizeRawg({ id: 1, name: 'E-Day' })];
  await C.writeCache(store, 'gears e day', games, { now: 1000 });
  const record = await C.readCache(store, 'gears e day', { now: 1000 + 60000 });
  assert.ok(record, 'fresh cache hit');
  assert.strictEqual(record.games.length, 1);

  const stale = await C.readCache(store, 'gears e day', { now: 1000 + C.CACHE_TTL_MS + 1 });
  assert.strictEqual(stale, null, 'expired cache ignored');

  const miss = await C.readCache(store, 'never written', { now: 1000 });
  assert.strictEqual(miss, null, 'missing cache is a miss');
});

test('cache: key is normalized so "E-Day" and "e day" share one entry', () => {
  assert.strictEqual(C.cacheId('E-Day'), C.cacheId('e day'));
  assert.strictEqual(C.cacheId('E-Day'), 'catalog:rawg:search:e day');
});

test('cache: a broken store never throws (cache is best-effort)', async () => {
  const broken = { get: () => Promise.reject(new Error('boom')), put: () => Promise.reject(new Error('boom')) };
  assert.strictEqual(await C.readCache(broken, 'x'), null);
  assert.strictEqual(await C.writeCache(broken, 'x', []), null);
  assert.strictEqual(await C.readCache(null, 'x'), null);
});

/* --------------------------- endpoint resolution ------------------------- */

test('resolveEndpoint: proxy URL wins over the default RAWG endpoint', () => {
  assert.strictEqual(C.resolveEndpoint({ proxyUrl: 'http://localhost:8787/api/rawg/games' }), 'http://localhost:8787/api/rawg/games');
  assert.strictEqual(C.resolveEndpoint({}), C.DEFAULT_ENDPOINT);
});

/* ---------------------- universal search includes E-Day ------------------- */

test('universal search finds Gears of War: E-Day offline (seed graph)', () => {
  const graph = L.buildGraph(seedGraph(), { nodes: [], edges: [] });
  const hits = L.search(graph, 'gears of war e day');
  assert.ok(hits.some((n) => n.id === 'game:gears-of-war-e-day'), 'full name finds E-Day');
  const short = L.search(graph, 'e-day');
  assert.ok(short.some((n) => n.id === 'game:gears-of-war-e-day'), 'alias "e-day" finds it');
  const eday = graph.byId['game:gears-of-war-e-day'];
  assert.ok(eday, 'node exists');
  assert.strictEqual(eday.metadata.year, 2026);
  const edges = L.edgesOf(graph, 'game:gears-of-war-e-day');
  assert.ok(edges.some((e) => e.relationship_type === 'MEMBER_OF' && e.target === 'franchise:gears-of-war'), 'franchise membership');
  assert.ok(edges.some((e) => e.relationship_type === 'DEVELOPED_BY'), 'developer credit');
  assert.ok(edges.some((e) => e.relationship_type === 'USES_MECHANIC'), 'mechanics linked');
  assert.ok(edges.some((e) => e.relationship_type === 'AVAILABLE_ON'), 'platform availability');
});
