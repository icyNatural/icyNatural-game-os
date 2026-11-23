'use strict';

// Source-only entrypoint contract test: never opens a socket or serves app data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const entry = path.resolve(__dirname, '../tools/serve.mjs');
const source = fs.readFileSync(entry, 'utf8');

function binding(args) {
  let received;
  // Replace only ESM syntax; run the actual entrypoint against an inert HTTP stub.
  const executable = source
    .replace(/^import .+;\r?\n/gm, '')
    .replace('fileURLToPath(import.meta.url)', '__filename');
  const server = { listen(...values) { received = values; } };
  vm.runInNewContext(executable, {
    http: { createServer(handler) {
      assert.equal(typeof handler, 'function');
      return server;
    } },
    fs: { readFile() { throw new Error('No app data reads allowed'); } },
    path,
    __filename: entry,
    process: { argv: ['node', entry, ...args], env: { ...process.env } },
    console: { log() {} },
  }, { filename: entry, timeout: 1000 });
  assert.ok(received, 'entrypoint must call listen');
  assert.equal(typeof received[2], 'function');
  return received.slice(0, 2);
}

test('static server explicitly binds loopback at default port', () => {
  assert.deepEqual(binding([]), [8080, '127.0.0.1']);
});

test('dynamic port retains explicit loopback even when HOST requests wildcard', () => {
  const previous = process.env.HOST;
  try {
    process.env.HOST = '0.0.0.0';
    assert.deepEqual(binding(['--port', '49231']), [49231, '127.0.0.1']);
  } finally {
    if (previous === undefined) delete process.env.HOST;
    else process.env.HOST = previous;
  }
});