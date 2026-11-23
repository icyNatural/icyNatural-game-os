'use strict';
/**
 * RAWG proxy smoke test: the proxy must add CORS headers so the browser can
 * read responses, and must forward upstream status honestly — never a fake
 * 200. Uses a local mock upstream so the test never touches the network.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PROXY = path.join(__dirname, '..', 'tools', 'rawg-proxy.mjs');

function startMockUpstream(status, body) {
  const server = http.createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startProxy(env) {
  const child = spawn(process.execPath, [PROXY, '--port', '0'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy did not start')), 5000);
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.on('error', reject);
  });
}

test('rawg-proxy adds CORS headers and forwards upstream 401 honestly', async () => {
  const upstream = await startMockUpstream(401, { error: 'The key parameter is not provided' });
  const proxy = await startProxy({
    RAWG_API_KEY: '',
    RAWG_UPSTREAM: `http://127.0.0.1:${upstream.port}/api/games`
  });
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/api/games?search=mario&page_size=2`);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), '*',
      'proxy must set CORS so the browser can read the error');
    assert.strictEqual(response.status, 401,
      'missing key must surface as 401, never a fake success');
  } finally {
    proxy.child.kill();
    upstream.server.close();
  }
});

test('rawg-proxy forwards a successful upstream response with CORS', async () => {
  const payload = { count: 1, results: [{ id: 1, name: 'Mario', slug: 'mario', released: null, platforms: [], developers: [] }] };
  const upstream = await startMockUpstream(200, payload);
  const proxy = await startProxy({
    RAWG_API_KEY: 'test-key-not-real',
    RAWG_UPSTREAM: `http://127.0.0.1:${upstream.port}/api/games`
  });
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/api/games?search=mario&page_size=2`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
    const body = await response.json();
    assert.strictEqual(body.results[0].name, 'Mario');
  } finally {
    proxy.child.kill();
    upstream.server.close();
  }
});

test('rawg-proxy rejects requests without a search parameter', async () => {
  const upstream = await startMockUpstream(200, { results: [] });
  const proxy = await startProxy({
    RAWG_API_KEY: '',
    RAWG_UPSTREAM: `http://127.0.0.1:${upstream.port}/api/games`
  });
  try {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/api/games`);
    assert.strictEqual(response.status, 400);
  } finally {
    proxy.child.kill();
    upstream.server.close();
  }
});
