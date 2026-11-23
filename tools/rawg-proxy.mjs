/**
 * Local RAWG proxy for Game OS.
 *
 * RAWG's API requires a key and does not send CORS headers, so a browser
 * cannot call it directly. This zero-dependency proxy runs on your machine,
 * reads the key from the environment (never from disk by this script), and
 * forwards searches with permissive CORS so the static site can use it.
 *
 * Usage:
 *   RAWG_API_KEY=your-key node tools/rawg-proxy.mjs [--port 8787]
 *
 * Then in Game OS Settings set the RAWG proxy URL to:
 *   http://localhost:8787/api/games
 *
 * The key is never logged and never sent anywhere except api.rawg.io.
 */
import http from 'node:http';

const PORT_FLAG = process.argv.indexOf('--port');
const PORT = PORT_FLAG !== -1 ? Number(process.argv[PORT_FLAG + 1]) : 8787;
const API_KEY = process.env.RAWG_API_KEY || '';
const UPSTREAM = process.env.RAWG_UPSTREAM || 'https://api.rawg.io/api/games';
const ALLOW_ORIGIN = process.env.RAWG_PROXY_ORIGIN || '*';

if (!API_KEY) {
  console.warn('[rawg-proxy] WARNING: RAWG_API_KEY is not set — requests will fail with 401.');
  console.warn('[rawg-proxy] Get a free key at https://rawg.io/apidocs then re-run with RAWG_API_KEY=...');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET' || !req.url) { res.writeHead(405); res.end(); return; }

  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }

  const search = url.searchParams.get('search');
  if (!search) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"missing search param"}'); return; }

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('search', search);
  upstream.searchParams.set('page_size', url.searchParams.get('page_size') || '12');
  upstream.searchParams.set('key', API_KEY);

  fetch(upstream, { headers: { Accept: 'application/json' } })
    .then(async (r) => {
      const body = await r.text();
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end('{"error":"upstream unreachable"}');
    });
});

server.listen(PORT, '127.0.0.1', () => {
  const bound = server.address().port;
  console.log(`[rawg-proxy] listening on http://127.0.0.1:${bound}/api/games?search=...`);
  console.log(`[rawg-proxy] key ${API_KEY ? 'loaded from RAWG_API_KEY (hidden)' : 'MISSING'}`);
});
