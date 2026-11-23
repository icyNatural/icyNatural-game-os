'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { load } = require('./helpers');
load();
require(path.join(__dirname, '..', 'assets', 'js', 'domain', 'media.js'));
const M = globalThis.GOS.media;

function file(over) { return Object.assign({ name: 'clip.webm', type: 'video/webm', size: 1024 }, over); }

test('media validation enforces supported types and bounds', () => {
  assert.strictEqual(M.validate(file()).ok, true);
  assert.strictEqual(M.validate(file({ type: 'text/plain' })).ok, false);
  assert.strictEqual(M.validate(file({ size: M.MAX_BYTES + 1 })).ok, false);
});

test('attachments default to explicit private status and never auto publish', () => {
  const record = M.metadata(file(), { id: 'media:1', gameId: 'game:a' });
  assert.strictEqual(record.visibility, 'private');
  assert.strictEqual(record.autoPublish, false);
  assert.strictEqual(record.source, 'local-browser-file');
});

test('private attachments do not produce public presentation records', () => {
  const record = M.metadata(file(), { id: 'media:2', visibility: 'private' });
  assert.strictEqual(M.publicRecord(record), null);
});

test('public presentation record is metadata-only and remains unpublished', () => {
  const record = M.metadata(file(), { id: 'media:3', visibility: 'public', experienceId: 'exp:1' });
  const output = M.publicRecord(record);
  assert.strictEqual(output.published, false);
  assert.strictEqual(output.status, 'local-reference-only');
  assert.strictEqual(output.media.name, 'clip.webm');
  assert.ok(!Object.prototype.hasOwnProperty.call(output, 'bytes'));
});