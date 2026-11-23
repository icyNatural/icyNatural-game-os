'use strict';
/**
 * Storage layer tests: migration, persistence, export/import, legacy safety.
 * Runs in Node against a localStorage shim (IndexedDB is unavailable →
 * the store uses its documented localstorage fallback backend).
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { load } = require('./helpers');

/* ---- localStorage shim (must exist before store.js init) ---- */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
    _map: map
  };
}
globalThis.localStorage = makeStorage();

load();
require(path.join(__dirname, '..', 'assets', 'js', 'storage', 'store.js'));
const GOS = globalThis.GOS;
const S = () => GOS.storage;

const LEGACY_LATEST = 'icyNaturalGameOS';
const LEGACY_HISTORY = 'icyNaturalGameOSHistory';

function legacyReview(name, score) {
  return {
    gameName: name, platform: 'PC',
    control: 8, clarity: 7, freedom: 8, expression: 7,
    engagement: 9, depth: 8, flow: 7, intensity: 8, replay: 6,
    friction: [], score, notes: '', time: Date.now()
  };
}

function buildRecords(history) {
  return {
    games: [], library: [], sessions: [], signals: [], evidence: [],
    experiences: (history || []).map((item, index) => ({
      id: 'exp:mig:' + index,
      gameId: 'game:mig:' + index,
      gameName: item.gameName,
      platform: item.platform,
      scores: {
        control: item.control, clarity: item.clarity, freedom: item.freedom,
        expression: item.expression, engagement: item.engagement, depth: item.depth,
        flow: item.flow, intensity: item.intensity, replay: item.replay
      },
      score: item.score, verdict: 'positive', friction: item.friction || [],
      notes: item.notes || '', context: { mode: 'overall' }, signals: [],
      created_at: new Date(item.time || Date.now()).toISOString()
    }))
  };
}

test('init falls back to localstorage backend in Node', async () => {
  const info = await S().init();
  assert.strictEqual(info.mode, 'localstorage');
  assert.strictEqual(S().mode(), 'localstorage');
  assert.ok(S().isReady());
});

test('migration imports legacy history, keeps legacy keys, records backup', async () => {
  localStorage.setItem(LEGACY_HISTORY, JSON.stringify([
    legacyReview('Halo Infinite', 8), legacyReview('Hi-Fi Rush', 9)
  ]));
  localStorage.setItem(LEGACY_LATEST, JSON.stringify(legacyReview('Hi-Fi Rush', 9)));

  const result = await S().migrateLegacy(buildRecords);
  assert.strictEqual(result.skipped, false, 'first migration runs');
  assert.strictEqual(result.state.completed, true);
  assert.strictEqual(result.state.counts.experiences, 2);

  const experiences = await S().all('experiences');
  assert.strictEqual(experiences.length, 2, 'both legacy reviews imported');

  // legacy keys are preserved, plus a backup was written
  assert.ok(localStorage.getItem(LEGACY_HISTORY), 'legacy history key preserved');
  assert.ok(localStorage.getItem(LEGACY_LATEST), 'legacy latest key preserved');
  assert.ok(result.state.backupKey, 'pre-migration backup exists');
  assert.ok(localStorage.getItem(result.state.backupKey), 'backup key readable');

  // idempotent
  const second = await S().migrateLegacy(buildRecords);
  assert.strictEqual(second.skipped, true, 'second migration is a no-op');
  const after = await S().all('experiences');
  assert.strictEqual(after.length, 2, 'no duplicate import');
});

test('multiple experiences for the same game survive (no name dedupe)', async () => {
  const before = (await S().all('experiences')).length;
  await S().put('experiences', {
    id: 'exp:same-game:1', gameId: 'game:dark-souls', gameName: 'Dark Souls',
    scores: { control: 9 }, score: 9, verdict: 'positive',
    context: { mode: 'overall' }, signals: []
  });
  await S().put('experiences', {
    id: 'exp:same-game:2', gameId: 'game:dark-souls', gameName: 'Dark Souls',
    scores: { control: 8 }, score: 8, verdict: 'positive',
    context: { mode: 'combat' }, signals: []
  });
  const all = await S().all('experiences');
  const same = all.filter((e) => e.gameId === 'game:dark-souls');
  assert.strictEqual(same.length, 2, 'both experiences kept');
  assert.strictEqual(all.length, before + 2, 'nothing else changed');
});

test('library entries update by id and persist', async () => {
  await S().put('library', { id: 'library:dark-souls', gameId: 'game:dark-souls', status: 'interested' });
  await S().put('library', { id: 'library:dark-souls', gameId: 'game:dark-souls', status: 'backlog' });
  const entries = await S().all('library');
  assert.strictEqual(entries.length, 1, 'same id replaces, never duplicates');
  assert.strictEqual(entries[0].status, 'backlog', 'status updated');
});

test('export produces a complete, well-formed payload', async () => {
  const payload = await S().exportAll();
  assert.strictEqual(payload.format, 'icyNaturalGameOS.export');
  assert.strictEqual(typeof payload.schemaVersion, 'number');
  assert.ok(payload.exportedAt);
  assert.ok(payload.collections, 'collections present');
  S().COLLECTIONS.forEach((name) => {
    assert.ok(Array.isArray(payload.collections[name]), `collection ${name} is an array`);
  });
  assert.ok(payload.collections.experiences.length >= 4, 'experiences exported');
  assert.ok(payload.collections.library.length >= 1, 'library exported');
  assert.ok(Array.isArray(payload.legacy.keys), 'legacy keys documented in export');
  assert.ok(payload.legacy.history.includes('Halo Infinite'), 'legacy history content exported');
});

test('validateImport rejects malformed payloads with useful errors', () => {
  const bad1 = S().validateImport(null);
  assert.strictEqual(bad1.ok, false);
  const bad2 = S().validateImport({ format: 'something-else', schemaVersion: 1, collections: {} });
  assert.strictEqual(bad2.ok, false);
  assert.ok(bad2.errors.some((e) => /format/i.test(e)), 'format error reported');
  const bad3 = S().validateImport({
    format: S().EXPORT_FORMAT, schemaVersion: 999, collections: {}
  });
  assert.strictEqual(bad3.ok, false);
  assert.ok(bad3.errors.some((e) => /newer/i.test(e)), 'schema version guard');
  const bad4 = S().validateImport({
    format: S().EXPORT_FORMAT, schemaVersion: 1, collections: { experiences: [{ noId: true }] }
  });
  assert.strictEqual(bad4.ok, false);
  assert.ok(bad4.errors.some((e) => /\.id/.test(e)), 'record id validation');
});

test('importAll writes nothing when validation fails', async () => {
  const before = await S().exportAll();
  const result = await S().importAll({ format: 'nope', schemaVersion: 1, collections: { experiences: [{ id: 'x' }] } });
  assert.strictEqual(result.ok, false);
  const after = await S().exportAll();
  assert.strictEqual(after.collections.experiences.length, before.collections.experiences.length,
    'experience count unchanged after failed import');
  assert.strictEqual(after.collections.library.length, before.collections.library.length);
});

test('importAll merges a valid payload by id and persists across reload', async () => {
  const exported = await S().exportAll();
  exported.collections.experiences.push({
    id: 'exp:imported:1', gameId: 'game:imported', gameName: 'Imported Game',
    scores: { control: 7 }, score: 7, verdict: 'positive',
    context: { mode: 'overall' }, signals: []
  });
  exported.collections.library.push({
    id: 'library:imported', gameId: 'game:imported', status: 'wishlist'
  });

  const result = await S().importAll(exported);
  assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
  assert.strictEqual(result.counts.experiences, exported.collections.experiences.length);

  /* ---- simulated page reload: fresh module, same localStorage ---- */
  const storePath = path.join(__dirname, '..', 'assets', 'js', 'storage', 'store.js');
  delete require.cache[require.resolve(storePath)];
  require(storePath);
  const reloaded = GOS.storage;
  await reloaded.init();
  const experiences = await reloaded.all('experiences');
  const library = await reloaded.all('library');
  assert.ok(experiences.some((e) => e.id === 'exp:imported:1'), 'imported experience survives reload');
  assert.ok(library.some((l) => l.id === 'library:imported'), 'imported library entry survives reload');
  assert.strictEqual(
    experiences.filter((e) => e.gameId === 'game:dark-souls').length, 2,
    'same-game experiences still not deduped after reload');
});

test('mirrorLegacy keeps legacy contract without dropping old entries', async () => {
  const preexisting = [{ gameName: 'Ancient Review', score: 5, __experienceId: 'legacy:old' }];
  localStorage.setItem(LEGACY_HISTORY, JSON.stringify(preexisting));

  const experiences = await S().all('experiences');
  S().mirrorLegacy(experiences);

  const history = JSON.parse(localStorage.getItem(LEGACY_HISTORY));
  assert.ok(history.some((item) => item.gameName === 'Ancient Review'), 'old legacy entry preserved');
  const mirrored = history.filter((item) => item.__experienceId);
  assert.ok(mirrored.length >= 3, 'experiences mirrored with __experienceId');
  assert.ok(mirrored.every((item) => typeof item.__experienceId === 'string'));

  // idempotent mirror: same count on second run
  S().mirrorLegacy(experiences);
  const history2 = JSON.parse(localStorage.getItem(LEGACY_HISTORY));
  assert.strictEqual(history2.length, history.length, 're-mirror does not duplicate');
});

test('mirrorLegacy prepends a newer experience without clobbering an existing row', async () => {
  // Regression: index-based replacement + unshift shifted stale indices, so the
  // existing row overwrote the newly prepended one (duplicate id, lost record).
  const existing = (await S().all('experiences')).slice();
  const first = existing[0];
  S().mirrorLegacy([first]);

  const newer = {
    ...first,
    id: 'exp:mirror:newer',
    gameName: 'Newer Game',
    score: 7.5,
    created_at: '2999-01-01T00:00:00.000Z'
  };
  S().mirrorLegacy([newer, first]);

  const history = JSON.parse(localStorage.getItem(LEGACY_HISTORY));
  const rows = history.filter((item) => item && item.__experienceId);
  const byId = rows.reduce((acc, item) => {
    acc[item.__experienceId] = (acc[item.__experienceId] || 0) + 1;
    return acc;
  }, {});

  assert.ok(rows.some((item) => item.gameName === 'Newer Game'), 'newer experience prepended');
  assert.strictEqual(byId[first.id], 1, 'existing mirrored row not duplicated');
  assert.ok(rows.some((item) => item.gameName === first.gameName), 'existing mirrored row preserved');
  assert.ok(history.some((item) => item.gameName === 'Ancient Review'), 'legacy entry still preserved');

  // idempotent after the fix too
  S().mirrorLegacy([newer, first]);
  const history2 = JSON.parse(localStorage.getItem(LEGACY_HISTORY));
  assert.strictEqual(history2.length, history.length, 're-mirror stays idempotent');
});

test('legacy keys are never deleted by any store operation', async () => {
  // even after remove/clear-style operations
  await S().remove('experiences', 'exp:same-game:2');
  const payload = await S().exportAll();
  await S().importAll(payload);

  assert.ok(localStorage.getItem(LEGACY_HISTORY) !== null, LEGACY_HISTORY + ' still present');
  assert.ok(localStorage.getItem(LEGACY_LATEST) !== null, LEGACY_LATEST + ' still present');

  const state = S().migrationState();
  assert.strictEqual(state.completed, true);
  assert.deepStrictEqual(state.legacyKeysPreserved, [LEGACY_LATEST, LEGACY_HISTORY]);
});

test('migration state is reported, not guessed', () => {
  const state = S().migrationState();
  assert.strictEqual(state.schemaVersion, S().SCHEMA_VERSION);
  assert.strictEqual(state.migrationVersion, S().MIGRATION_VERSION);
  assert.ok(state.completedAt, 'completion timestamp recorded');
});

test('catalogCache round-trips and is excluded from export', async () => {
  const record = {
    id: 'catalog:rawg:search:hades',
    query: 'hades',
    games: [{ id: 'game:rawg:1', name: 'Hades' }],
    cached_at: new Date().toISOString()
  };
  await S().put('catalogCache', record);
  const read = await S().get('catalogCache', record.id);
  assert.ok(read, 'catalog cache readable');
  assert.strictEqual(read.games[0].name, 'Hades');

  const payload = await S().exportAll();
  assert.ok(!('catalogCache' in payload.collections), 'catalog cache is never exported');
  assert.ok(S().STORES.includes('catalogCache'), 'catalogCache is a real store');
  assert.ok(!S().COLLECTIONS.includes('catalogCache'), 'catalogCache is not a data collection');
});

test('recovery keeps unusual scores, all fields and IDs, verifies backups, and is idempotent', async () => {
  const source = await S().exportAll();
  const before = JSON.parse(JSON.stringify(source.collections));
  source.collections.experiences.push({
    id: 'exp:recovery:unusual', gameId: 'game:melty-blood', gameName: 'Melty Blood',
    score: 11.0, scores: { control: 11, clarity: 9.3 }, notes: 'Keep exactly.',
    context: { mode: 'overall' }, mediaReference: 'original-file.mp4'
  });
  source.collections.signals.push({ id: 'sig:recovery', experienceId: 'exp:recovery:unusual', polarity: 'positive' });
  source.collections.evidence.push({ id: 'media:recovery', experienceId: 'exp:recovery:unusual', name: 'original-file.mp4', visibility: 'private' });
  const result = await S().importAll(source);
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.added.experiences, 1);
  assert.deepStrictEqual(JSON.parse(localStorage.getItem(result.backupKey)).collections, before);
  assert.deepStrictEqual(JSON.parse(localStorage.getItem(result.incomingKey)), source);
  assert.deepStrictEqual((await S().exportAll()).collections, source.collections);
  const second = await S().importAll(source);
  assert.strictEqual(second.added.experiences, 0);
  assert.strictEqual(second.duplicates.experiences, source.collections.experiences.length);
  assert.strictEqual((await S().get('experiences', 'exp:recovery:unusual')).score, 11);
});

test('same-ID conflict rejects the entire merge without overwriting or adding anything', async () => {
  const source = await S().exportAll();
  const before = JSON.parse(JSON.stringify(source.collections));
  source.collections.experiences.find(record => record.id === 'exp:recovery:unusual').score = 10;
  source.collections.games.push({ id: 'game:must-not-import', name: 'Not Written' });
  const result = await S().importAll(source);
  assert.strictEqual(result.ok, false);
  assert.ok(result.conflicts.includes('experiences/exp:recovery:unusual'));
  assert.deepStrictEqual((await S().exportAll()).collections, before);
});

test('backup quota failure stops before writes and leaves every collection unchanged', async () => {
  const source = await S().exportAll();
  const before = JSON.parse(JSON.stringify(source.collections));
  source.collections.games.push({ id: 'game:quota-must-not-import', name: 'Not Written' });
  const original = localStorage.setItem;
  localStorage.setItem = (key, value) => {
    if (key.startsWith('icyNaturalGameOSRecovery.')) throw new Error('Quota exceeded');
    original(key, value);
  };
  try { await assert.rejects(S().importAll(source), /Quota exceeded/); }
  finally { localStorage.setItem = original; }
  assert.deepStrictEqual((await S().exportAll()).collections, before);
});

test('atomic fallback commit failure leaves persistent data and cache unchanged', async () => {
  const source = await S().exportAll();
  const before = JSON.parse(JSON.stringify(source.collections));
  source.collections.games.push({ id: 'game:commit-must-not-import', name: 'Not Written' });
  const original = localStorage.setItem;
  localStorage.setItem = (key, value) => {
    if (key === 'icyNaturalGameOS.db.v2') throw new Error('Commit denied');
    original(key, value);
  };
  try { await assert.rejects(S().importAll(source), /Commit denied/); }
  finally { localStorage.setItem = original; }
  assert.deepStrictEqual((await S().exportAll()).collections, before);
});

test('export recovery metadata is restricted to Game OS keys', async () => {
  localStorage.setItem('unrelated-secret', 'DO NOT EXPORT');
  const exported = await S().exportAll();
  assert.ok(exported.recovery.localStorage.icyNaturalGameOSHistory);
  assert.ok(!JSON.stringify(exported).includes('DO NOT EXPORT'));
});
