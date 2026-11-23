/** Read-only Game OS export verifier and optional private archive, no browser/profile access. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.localStorage = { getItem: () => null };
require('../assets/js/storage/store.js');
const [input, archiveDirectory] = process.argv.slice(2);
if (!input) throw new Error('Usage: node tools/verify-backup.mjs <export.json> [private-archive-directory]');
const bytes = fs.readFileSync(path.resolve(input));
const payload = JSON.parse(bytes.toString('utf8'));
const check = globalThis.GOS.storage.validateImport(payload);
if (!check.ok) throw new Error(check.errors.join('\n'));
if (globalThis.GOS.storage.COLLECTIONS.some(name => !Array.isArray(payload.collections[name]))) {
  throw new Error('Incomplete export: all application collections are required for recovery');
}
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const report = {
  sourceFile: path.resolve(input), sha256: digest, bytes: bytes.length,
  source: payload.source || null, counts: check.counts,
  experiences: payload.collections.experiences.map(record => ({
    id: record.id, gameId: record.gameId, gameName: record.gameName, score: record.score
  })),
  legacyHistoryCount: payload.legacy?.history ? JSON.parse(payload.legacy.history).length : 0,
  verifiedAt: new Date().toISOString()
};
if (archiveDirectory) {
  const dir = path.resolve(archiveDirectory);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'game-os-' + digest + '.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
  if (!fs.readFileSync(file).equals(bytes)) throw new Error('Archive read-back failed');
  const reportFile = file + '.verification.json';
  if (!fs.existsSync(reportFile)) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
  report.archiveFile = file;
}
console.log(JSON.stringify(report, null, 2));