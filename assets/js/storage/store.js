/**
 * icyNatural Game OS — local-first storage.
 *
 * Primary store: IndexedDB (structured, one object store per collection).
 * Fallback: a single namespaced localStorage blob (used automatically when
 * IndexedDB is unavailable, e.g. some file:// privacy modes).
 *
 * Guarantees this module makes:
 *   1. The legacy keys `icyNaturalGameOS` and `icyNaturalGameOSHistory` are
 *      NEVER deleted. They are read for migration, backed up, then mirrored
 *      on write so anything that still reads them keeps working.
 *   2. Migration is idempotent and recorded separately
 *      (`icyNaturalGameOSMigration`) with a pre-migration backup key.
 *   3. Export is a plain JSON document; import validates the whole payload
 *      BEFORE writing anything and merges by id (never silently discards).
 */
(function (root) {
  'use strict';

  var GOS = (root.GOS = root.GOS || {});
  var U = GOS.util || {};

  var SCHEMA_VERSION = 3;
  var MIGRATION_VERSION = 1;
  var DB_NAME = 'icyNaturalGameOS';
  var DB_VERSION = 2;
  var LS_DB_KEY = 'icyNaturalGameOS.db.v2';
  var MIGRATION_KEY = 'icyNaturalGameOSMigration';
  var BACKUP_PREFIX = 'icyNaturalGameOSBackup.';
  var EXPORT_FORMAT = 'icyNaturalGameOS.export';

  var LEGACY = {
    latest: 'icyNaturalGameOS',
    history: 'icyNaturalGameOSHistory'
  };

  var COLLECTIONS = [
    'entities',       // user overlay on the seed graph
    'edges',
    'games',          // canonical Game records
    'library',        // LibraryEntry per game
    'sessions',       // PlaySession
    'experiences',    // ExperienceLog
    'signals',        // ExperienceSignal
    'taste',          // TastePattern snapshots
    'recommendations',// Recommendation
    'evidence'        // EvidenceAttachment
  ];
  var STORES = COLLECTIONS.concat(['catalogCache']); // cache is local-only and never exported

  /* ------------------------------ backends -------------------------------- */

  function IdbBackend() {
    this.db = null;
    this.name = 'indexeddb';
  }

  IdbBackend.prototype.open = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) {
        reject(new Error('indexedDB unavailable'));
        return;
      }
      var request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };
      request.onsuccess = function () {
        self.db = request.result;
        resolve();
      };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB open failed'));
      };
      request.onblocked = function () {
        reject(new Error('IndexedDB blocked'));
      };
    });
  };

  IdbBackend.prototype._tx = function (name, mode) {
    return this.db.transaction(name, mode).objectStore(name);
  };

  IdbBackend.prototype.all = function (collection) {
    var store = this._tx(collection, 'readonly');
    return new Promise(function (resolve, reject) {
      var req = store.getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  };

  IdbBackend.prototype.get = function (collection, id) {
    var store = this._tx(collection, 'readonly');
    return new Promise(function (resolve, reject) {
      var req = store.get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  };

  IdbBackend.prototype.put = function (collection, record) {
    var store = this._tx(collection, 'readwrite');
    return new Promise(function (resolve, reject) {
      var req = store.put(record);
      req.onsuccess = function () { resolve(record); };
      req.onerror = function () { reject(req.error); };
    });
  };

  IdbBackend.prototype.putMany = function (collection, records) {
    var self = this;
    return records.reduce(function (chain, record) {
      return chain.then(function () { return self.put(collection, record); });
    }, Promise.resolve());
  };

  // Commit an import as one transaction; request success alone is not a commit.
  IdbBackend.prototype.mergeBatch = function (additions, preserveExisting) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var tx = self.db.transaction(COLLECTIONS, 'readwrite');
      var conflict = null;
      COLLECTIONS.forEach(function (name) {
        var store = tx.objectStore(name);
        (additions[name] || []).forEach(function (record) {
          var request = store.get(record.id);
          request.onsuccess = function () {
            if (request.result && preserveExisting && preserveExisting.indexOf(name) !== -1) return;
            if (request.result && stableJson(request.result) !== stableJson(record)) {
              conflict = new Error('Concurrent import conflict: ' + name + '/' + record.id);
              tx.abort();
            } else if (!request.result) store.add(record);
          };
        });
      });
      tx.oncomplete = function () { resolve(); };
      tx.onabort = tx.onerror = function () { reject(conflict || tx.error || new Error('Import transaction aborted')); };
    });
  };

  IdbBackend.prototype.remove = function (collection, id) {
    var store = this._tx(collection, 'readwrite');
    return new Promise(function (resolve, reject) {
      var req = store.delete(id);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { reject(req.error); };
    });
  };

  IdbBackend.prototype.clear = function (collection) {
    var store = this._tx(collection, 'readwrite');
    return new Promise(function (resolve, reject) {
      var req = store.clear();
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { reject(req.error); };
    });
  };

  /* --- localStorage fallback: one JSON blob, same async surface --- */

  function LocalBackend() {
    this.name = 'localstorage';
    this.cache = null;
  }

  LocalBackend.prototype._read = function () {
    if (this.cache) return this.cache;
    var blob = {};
    try {
      var raw = root.localStorage.getItem(LS_DB_KEY);
      if (raw) blob = JSON.parse(raw);
    } catch (e) { blob = {}; }
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) blob = {};
    STORES.forEach(function (name) {
      if (!blob[name] || typeof blob[name] !== 'object') blob[name] = {};
    });
    this.cache = blob;
    return blob;
  };

  LocalBackend.prototype._write = function () {
    try {
      root.localStorage.setItem(LS_DB_KEY, JSON.stringify(this.cache));
      return true;
    } catch (e) {
      return false;
    }
  };

  LocalBackend.prototype.open = function () { return Promise.resolve(); };
  LocalBackend.prototype.all = function (collection) {
    var map = this._read()[collection] || {};
    return Promise.resolve(Object.keys(map).map(function (k) { return map[k]; }));
  };
  LocalBackend.prototype.get = function (collection, id) {
    return Promise.resolve((this._read()[collection] || {})[id] || null);
  };
  LocalBackend.prototype.put = function (collection, record) {
    var blob = this._read();
    blob[collection] = blob[collection] || {};
    blob[collection][record.id] = record;
    this._write();
    return Promise.resolve(record);
  };
  LocalBackend.prototype.putMany = function (collection, records) {
    var self = this;
    records.forEach(function (record) { self.put(collection, record); });
    return Promise.resolve(records);
  };

  LocalBackend.prototype.mergeBatch = function (additions, preserveExisting) {
    try {
      // Re-read persistent state, then perform a single all-or-nothing setItem.
      this.cache = null;
      var next = JSON.parse(JSON.stringify(this._read()));
      COLLECTIONS.forEach(function (name) {
        (additions[name] || []).forEach(function (record) {
          var existing = next[name][record.id];
          if (existing && preserveExisting && preserveExisting.indexOf(name) !== -1) return;
          if (existing && stableJson(existing) !== stableJson(record)) {
            throw new Error('Concurrent import conflict: ' + name + '/' + record.id);
          }
          next[name][record.id] = record;
        });
      });
      root.localStorage.setItem(LS_DB_KEY, JSON.stringify(next));
      this.cache = next;
      return Promise.resolve();
    } catch (error) {
      this.cache = null;
      return Promise.reject(error);
    }
  };
  LocalBackend.prototype.remove = function (collection, id) {
    var blob = this._read();
    if (blob[collection]) delete blob[collection][id];
    this._write();
    return Promise.resolve(true);
  };
  LocalBackend.prototype.clear = function (collection) {
    var blob = this._read();
    blob[collection] = {};
    this._write();
    return Promise.resolve(true);
  };

  /* ------------------------------- the store ------------------------------ */

  var backend = null;
  var ready = false;

  function requireReady() {
    if (!ready) throw new Error('storage.init() has not completed');
  }

  function init() {
    if (ready) return Promise.resolve({ mode: backend.name });
    var idb = new IdbBackend();
    return idb.open().then(
      function () {
        backend = idb;
        ready = true;
        return { mode: 'indexeddb' };
      },
      function () {
        backend = new LocalBackend();
        ready = true;
        return { mode: 'localstorage' };
      }
    );
  }

  function all(collection) {
    requireReady();
    if (STORES.indexOf(collection) === -1) {
      return Promise.reject(new Error('Unknown collection: ' + collection));
    }
    return backend.all(collection);
  }

  function get(collection, id) {
    requireReady();
    return backend.get(collection, id);
  }

  function put(collection, record) {
    requireReady();
    if (!record || typeof record !== 'object') return Promise.reject(new Error('record must be an object'));
    if (!record.id) record.id = U.uid ? U.uid(collection) : collection + '-' + Math.random().toString(36).slice(2);
    if (!record.created_at) record.created_at = new Date().toISOString();
    record.updated_at = new Date().toISOString();
    return backend.put(collection, record);
  }

  function putMany(collection, records) {
    return (records || []).reduce(function (chain, record) {
      return chain.then(function () { return put(collection, record); });
    }, Promise.resolve()).then(function () { return records; });
  }

  function remove(collection, id) {
    requireReady();
    return backend.remove(collection, id);
  }

  /** Bulk upsert used by import (no updated_at churn, no per-record side effects). */
  function putRaw(collection, record) {
    requireReady();
    return backend.put(collection, record);
  }

  /* ------------------------- legacy localStorage -------------------------- */

  function readLegacyJson(key) {
    try {
      var raw = root.localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function readLegacyRaw(key) {
    try {
      return root.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeLegacy(key, value) {
    try {
      root.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Mirror the newest experiences into the legacy keys so anything reading
   * the original contract keeps working. Never removes older legacy entries —
   * it prepends and de-duplicates only exact id matches.
   */
  function mirrorLegacy(experiences) {
    if (!experiences || !experiences.length) return false;
    var ordered = experiences.slice().sort(function (a, b) {
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    var history = readLegacyJson(LEGACY.history);
    if (!Array.isArray(history)) history = [];

    // Build every mirrored record first, then reconcile by id. Never mix
    // index-based replacement with unshift/push — mutating the array while
    // holding stale indices overwrites the wrong rows.
    var mirroredByLegacyId = Object.create(null);

    ordered.forEach(function (experience) {
      mirroredByLegacyId[experience.id] = {
        __experienceId: experience.id,
        gameName: experience.gameName,
        platform: experience.platform,
        control: experience.scores.control,
        clarity: experience.scores.clarity,
        freedom: experience.scores.freedom,
        expression: experience.scores.expression,
        engagement: experience.scores.engagement,
        depth: experience.scores.depth,
        flow: experience.scores.flow,
        intensity: experience.scores.intensity,
        replay: experience.scores.replay,
        friction: experience.friction || [],
        score: experience.score,
        verdict: experience.verdict,
        notes: experience.notes || '',
        time: experience.date || Date.now()
      };
    });

    var reconciled = [];
    var placed = Object.create(null);

    history.forEach(function (item) {
      var legacyId = item && item.__experienceId;
      if (legacyId && Object.prototype.hasOwnProperty.call(mirroredByLegacyId, legacyId)) {
        if (!placed[legacyId]) {
          reconciled.push(mirroredByLegacyId[legacyId]);
          placed[legacyId] = true;
        }
        return;
      }
      reconciled.push(item);
    });

    var prepended = ordered
      .filter(function (experience) { return !placed[experience.id]; })
      .map(function (experience) {
        placed[experience.id] = true;
        return mirroredByLegacyId[experience.id];
      });

    history = prepended.concat(reconciled);

    // Keep at most 400 entries in the compatibility mirror; the structured
    // store keeps every record.
    if (history.length > 400) history = history.slice(0, 400);

    var latest = ordered[0];
    writeLegacy(LEGACY.history, history);
    writeLegacy(LEGACY.latest, {
      gameName: latest.gameName,
      platform: latest.platform,
      control: latest.scores.control,
      clarity: latest.scores.clarity,
      freedom: latest.scores.freedom,
      expression: latest.scores.expression,
      engagement: latest.scores.engagement,
      depth: latest.scores.depth,
      flow: latest.scores.flow,
      intensity: latest.scores.intensity,
      replay: latest.scores.replay,
      notes: latest.notes || '',
      friction: latest.friction || []
    });
    return true;
  }

  /* --------------------------- migration state ---------------------------- */

  function migrationState() {
    var state = readLegacyJson(MIGRATION_KEY);
    if (!state || typeof state !== 'object') {
      return { completed: false, schemaVersion: SCHEMA_VERSION, migrationVersion: MIGRATION_VERSION };
    }
    return state;
  }

  function setMigrationState(state) {
    writeLegacy(MIGRATION_KEY, state);
    return state;
  }

  function backupLegacy() {
    var payload = {
      format: 'icyNaturalGameOS.backup',
      backedUpAt: new Date().toISOString(),
      keys: {}
    };
    [LEGACY.latest, LEGACY.history].forEach(function (key) {
      var raw = readLegacyRaw(key);
      if (raw !== null) payload.keys[key] = raw;
    });
    if (!Object.keys(payload.keys).length) return null;
    var backupKey = BACKUP_PREFIX + Date.now();
    if (!writeLegacy(backupKey, payload)) return null;
    return backupKey;
  }

  /**
   * Import legacy localStorage reviews into the structured store.
   * `buildRecords(legacyHistory, legacyLatest)` must return
   * `{ games, library, experiences, signals, evidence, sessions }`.
   */
  function migrateLegacy(buildRecords) {
    var state = migrationState();
    if (state.completed) {
      return Promise.resolve({ skipped: true, state: state });
    }

    var history = readLegacyJson(LEGACY.history);
    var latest = readLegacyJson(LEGACY.latest);
    if (!Array.isArray(history)) history = [];
    if (!latest || typeof latest !== 'object') latest = null;
    if (!history.length && !latest) {
      var empty = {
        completed: true,
        completedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        migrationVersion: MIGRATION_VERSION,
        backupKey: null,
        counts: { experiences: 0, games: 0 }
      };
      return Promise.resolve({ skipped: false, state: setMigrationState(empty) });
    }

    var backupKey = backupLegacy();
    var built;
    try {
      built = buildRecords(history, latest) || {};
    } catch (error) {
      return Promise.reject(error);
    }

    var chains = [];
    (built.games || []).forEach(function (record) { chains.push(putRaw('games', record)); });
    (built.library || []).forEach(function (record) { chains.push(putRaw('library', record)); });
    (built.sessions || []).forEach(function (record) { chains.push(putRaw('sessions', record)); });
    (built.experiences || []).forEach(function (record) { chains.push(putRaw('experiences', record)); });
    (built.signals || []).forEach(function (record) { chains.push(putRaw('signals', record)); });
    (built.evidence || []).forEach(function (record) { chains.push(putRaw('evidence', record)); });

    return Promise.all(chains).then(function () {
      var nextState = {
        completed: true,
        completedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        migrationVersion: MIGRATION_VERSION,
        backupKey: backupKey,
        legacyKeysPreserved: [LEGACY.latest, LEGACY.history],
        counts: {
          legacyHistoryItems: history.length,
          experiences: (built.experiences || []).length,
          games: (built.games || []).length,
          signals: (built.signals || []).length
        }
      };
      return { skipped: false, state: setMigrationState(nextState), records: built };
    });
  }

  /* ------------------------------ export/import --------------------------- */

  function exportAll() {
    requireReady();
    var collections = {};
    var chain = Promise.resolve();
    COLLECTIONS.forEach(function (name) {
      chain = chain.then(function () {
        return all(name).then(function (records) {
          // Exports must be detached from the fallback backend's live cache.
          collections[name] = JSON.parse(JSON.stringify(records));
        });
      });
    });
    return chain.then(function () {
      return {
        format: EXPORT_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        migrationVersion: MIGRATION_VERSION,
        exportedAt: new Date().toISOString(),
        migration: migrationState(),
        legacy: {
          keys: [LEGACY.latest, LEGACY.history],
          latest: readLegacyRaw(LEGACY.latest),
          history: readLegacyRaw(LEGACY.history)
        },
        collections: collections,
        source: { url: root.location ? root.location.href : null, backend: backend.name },
        recovery: { localStorage: recoveryKeys() }
      };
    });
  }

  function recoveryKeys() {
    var keys = {};
    // Only this application's keys; never export unrelated browser storage.
    for (var i = 0; i < root.localStorage.length; i++) {
      var key = root.localStorage.key(i);
      if (key === LS_DB_KEY || key === MIGRATION_KEY || key === LEGACY.latest || key === LEGACY.history ||
          key.indexOf(BACKUP_PREFIX) === 0) keys[key] = root.localStorage.getItem(key);
    }
    return keys;
  }

  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + stableJson(value[key]);
    }).join(',') + '}';
    return JSON.stringify(value);
  }

  /**
   * Validate an import payload completely before writing anything.
   * Returns `{ ok, errors, counts }`; on failure NOTHING is written.
   */
  function validateImport(payload) {
    var errors = [];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, errors: ['Import payload must be a JSON object.'], counts: null };
    }
    if (payload.format !== EXPORT_FORMAT) {
      errors.push('Unrecognised format "' + String(payload.format) + '" — expected "' + EXPORT_FORMAT + '".');
    }
    if (typeof payload.schemaVersion !== 'number') {
      errors.push('Missing numeric schemaVersion.');
    } else if (payload.schemaVersion > SCHEMA_VERSION) {
      errors.push('Export schemaVersion ' + payload.schemaVersion + ' is newer than this app (' + SCHEMA_VERSION + ').');
    }
    if (!payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) {
      errors.push('Missing collections object.');
      return { ok: false, errors: errors, counts: null };
    }

    var counts = {};
    COLLECTIONS.forEach(function (name) {
      var value = payload.collections[name];
      if (value === undefined || value === null) {
        counts[name] = 0;
        return;
      }
      if (!Array.isArray(value)) {
        errors.push('collections.' + name + ' must be an array.');
        counts[name] = 0;
        return;
      }
      var seen = Object.create(null);
      value.forEach(function (record, index) {
        var path = 'collections.' + name + '[' + index + ']';
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          errors.push(path + ' must be an object.');
          return;
        }
        if (typeof record.id !== 'string' || record.id === '') {
          errors.push(path + '.id must be a non-empty string.');
          return;
        }
        if (seen[record.id]) errors.push(path + ' duplicates id "' + record.id + '" inside the payload.');
        seen[record.id] = true;
      });
      counts[name] = value.length;
    });

    return { ok: errors.length === 0, errors: errors, counts: counts };
  }

  /** Backup first; exact duplicates are skipped, conflicting IDs reject the entire import. */
  function importAll(payload) {
    var check = validateImport(payload);
    if (!check.ok) return Promise.resolve(check);
    requireReady();

    return exportAll().then(function (before) {
      var additions = {};
      var added = {};
      var duplicates = {};
      var conflicts = [];
      COLLECTIONS.forEach(function (name) {
        var existing = Object.create(null);
        before.collections[name].forEach(function (record) { existing[record.id] = record; });
        additions[name] = [];
        duplicates[name] = 0;
        (payload.collections[name] || []).forEach(function (record) {
          if (!existing[record.id]) additions[name].push(record);
          else if (stableJson(existing[record.id]) === stableJson(record)) duplicates[name]++;
          else conflicts.push(name + '/' + record.id);
        });
        added[name] = additions[name].length;
      });
      if (conflicts.length) return { ok: false, errors: ['Conflicting IDs; no records overwritten: ' + conflicts.join(', ')], counts: check.counts, conflicts: conflicts };

      var stamp = Date.now() + '.' + Math.random().toString(36).slice(2);
      var backupKey = 'icyNaturalGameOSRecovery.before.' + stamp;
      var incomingKey = 'icyNaturalGameOSRecovery.incoming.' + stamp;
      var backup = JSON.stringify(before);
      var incoming = JSON.stringify(payload);
      // Retain complete source/target payloads, including raw legacy references.
      // Quota/access failure stops the import BEFORE any collection is changed.
      root.localStorage.setItem(backupKey, backup);
      root.localStorage.setItem(incomingKey, incoming);
      if (root.localStorage.getItem(backupKey) !== backup || root.localStorage.getItem(incomingKey) !== incoming) {
        throw new Error('Recovery backup read-back verification failed');
      }
      return backend.mergeBatch(additions).then(function () { return exportAll(); }).then(function (after) {
        COLLECTIONS.forEach(function (name) {
          var expected = before.collections[name].concat(additions[name]);
          var actual = after.collections[name];
          var byId = Object.create(null);
          actual.forEach(function (record) { byId[record.id] = record; });
          if (actual.length !== expected.length || expected.some(function (record) {
            return stableJson(record) !== stableJson(byId[record.id]);
          })) throw new Error('Post-import verification failed: ' + name + '; recovery backups retained');
        });
        return { ok: true, errors: [], counts: check.counts, added: added, duplicates: duplicates,
          backupKey: backupKey, incomingKey: incomingKey, verified: true, mode: backend.name };
      });
    });
  }

  GOS.storage = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MIGRATION_VERSION: MIGRATION_VERSION,
    COLLECTIONS: COLLECTIONS,
    STORES: STORES,
    LEGACY: LEGACY,
    EXPORT_FORMAT: EXPORT_FORMAT,
    init: init,
    all: all,
    get: get,
    put: put,
    putMany: putMany,
    // New experiences are additions, never overwrites. Existing game/library
    // records are preserved inside the same transaction (including their status).
    saveExperienceBatch: function (additions) {
      requireReady();
      var allowed = ['experiences', 'signals', 'evidence', 'games', 'library'];
      if (!additions || Object.keys(additions).some(function (name) {
        return allowed.indexOf(name) === -1 || !Array.isArray(additions[name]) ||
          additions[name].some(function (record) { return !record || typeof record.id !== 'string' || !record.id; });
      })) return Promise.reject(new Error('Invalid experience batch'));
      if (!additions.experiences || additions.experiences.length !== 1) {
        return Promise.reject(new Error('Exactly one new experience is required'));
      }
      return backend.mergeBatch(additions, ['games', 'library']);
    },
    putRaw: putRaw,
    remove: remove,
    readLegacyJson: readLegacyJson,
    readLegacyRaw: readLegacyRaw,
    writeLegacy: writeLegacy,
    mirrorLegacy: mirrorLegacy,
    migrationState: migrationState,
    setMigrationState: setMigrationState,
    migrateLegacy: migrateLegacy,
    exportAll: exportAll,
    validateImport: validateImport,
    importAll: importAll,
    mode: function () { return backend ? backend.name : 'uninitialised'; },
    isReady: function () { return ready; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
