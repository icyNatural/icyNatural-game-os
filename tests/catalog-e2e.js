'use strict';
/**
 * Catalog E2E: real browser flow against a mock RAWG upstream.
 *
 * Covers what unit tests cannot: Settings proxy configuration, live catalog
 * search rendering, Add-to-library, personal-library persistence across
 * reload, cache write, and offline fallback when the upstream goes away.
 *
 * Run: npm run test:catalog
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveChromium } = require('./playwright-resolve');

const ROOT = path.join(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

let passed = 0;
let failed = 0;
function check(ok, label, detail) {
  if (ok) { passed++; console.log('PASS ' + label); }
  else { failed++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

/* --------------------------- mock RAWG upstream --------------------------- */

const MOCK_GAMES = [
  {
    id: 90001, name: 'Hades II', slug: 'hades-ii', released: '2025-09-25',
    background_image: null,
    platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 5' } }],
    developers: [{ name: 'Supergiant Games' }]
  },
  {
    id: 90002, name: 'Metroid Prime 4: Beyond', slug: 'metroid-prime-4-beyond', released: '2025-12-04',
    background_image: null,
    platforms: [{ platform: { name: 'Nintendo Switch' } }],
    developers: [{ name: 'Retro Studios' }]
  }
];

function startMockRawg() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = (url.searchParams.get('search') || '').toLowerCase();
    const results = MOCK_GAMES.filter((g) => g.name.toLowerCase().includes(q));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({ count: results.length, results }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* --------------------------------- suite --------------------------------- */

(async () => {
  const chromium = resolveChromium();
  const app = await startStaticServer();
  const mock = await startMockRawg();
  const appUrl = `http://127.0.0.1:${app.port}/index.html`;
  const proxyUrl = `http://127.0.0.1:${mock.port}/api/games`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  try {
    await page.goto(appUrl);
    await page.waitForFunction(() => window.GOS && GOS.gos && GOS.gos.context().booted, null, { timeout: 10000 });

    /* 1. Configure the proxy in Settings. */
    await page.click('.nav-btn[data-tab="settings"]');
    await page.fill('#catalogProxyUrl', proxyUrl);
    await page.click('#saveCatalogConfigBtn');
    const config = await page.evaluate(() => GOS.gos.catalogConfig().proxyUrl);
    check(config === proxyUrl, 'settings persist the catalog proxy URL', config);

    /* 2. Live catalog search renders mock RAWG rows with attribution. */
    await page.click('.nav-btn[data-tab="discover"]');
    await page.fill('#discoverSearch', 'Hades II');
    await page.waitForSelector('#discoverSearchResults .gos-search-item-catalog', { timeout: 8000 });
    const catalogVisible = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-catalog'));
      const attribution = document.querySelector('#discoverSearchResults .gos-search-attribution a');
      return {
        count: rows.length,
        firstName: rows[0] ? rows[0].querySelector('.gos-search-name').textContent : null,
        attributionHref: attribution ? attribution.href : null
      };
    });
    check(catalogVisible.count >= 1 && catalogVisible.firstName === 'Hades II',
      'live search shows RAWG catalog rows', JSON.stringify(catalogVisible));
    check(String(catalogVisible.attributionHref).indexOf('rawg.io') !== -1,
      'catalog rows carry RAWG attribution link', String(catalogVisible.attributionHref));

    /* 3. Add to library from the catalog row. */
    await page.click('#discoverSearchResults .gos-search-item-catalog .gos-search-add');
    await page.waitForFunction(() => {
      const ctx = window.GOS && GOS.gos && GOS.gos.context();
      return !!(ctx && (ctx.entities || []).some((e) => e.name === 'Hades II'));
    }, null, { timeout: 8000 });
    const afterAdd = await page.evaluate(() => {
      const ctx = GOS.gos.context();
      const game = (ctx.entities || []).filter((e) => e.name === 'Hades II')[0];
      const entry = (ctx.library || []).filter((l) => game && l.gameId === game.id)[0];
      return { gameId: game ? game.id : null, status: entry ? entry.status : null, source: game && game.metadata ? game.metadata.source : null };
    });
    check(afterAdd.gameId && afterAdd.status === 'discovered',
      'Add saves the game with discovered status', JSON.stringify(afterAdd));
    check(afterAdd.source === 'rawg', 'saved game keeps RAWG provenance', JSON.stringify(afterAdd));

    /* 4. Change library status and verify persistence across reload. */
    await page.selectOption('#discoverDetail .gos-library-field select', 'backlog');
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => window.GOS && GOS.gos && GOS.gos.context().booted, null, { timeout: 10000 });
    const persisted = await page.evaluate(() => {
      const ctx = GOS.gos.context();
      const game = (ctx.entities || []).filter((e) => e.name === 'Hades II')[0];
      const entry = (ctx.library || []).filter((l) => game && l.gameId === game.id)[0];
      return { gameId: game ? game.id : null, status: entry ? entry.status : null };
    });
    check(persisted.gameId && persisted.status === 'backlog',
      'library status persists across reload', JSON.stringify(persisted));

    /* 5. Saved game is findable offline (local graph search). */
    await page.click('.nav-btn[data-tab="discover"]');
    await page.fill('#discoverSearch', 'Hades');
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-local'));
      return rows.some((r) => r.textContent.indexOf('Hades II') !== -1);
    }, null, { timeout: 5000 });
    const localHit = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-local'))
        .some((r) => r.textContent.indexOf('Hades II') !== -1));
    check(localHit, 'added game is searchable from the local graph');

    /* 6. Cache round-trip: prime a second query, kill the upstream, re-search. */
    await page.fill('#discoverSearch', 'Metroid Prime');
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-catalog'));
      return rows.some((r) => r.textContent.indexOf('Metroid') !== -1);
    }, null, { timeout: 8000 });
    await new Promise((resolve) => { mock.server.close(resolve); });
    /* Hades II is now a local graph node (added in step 3) — its cached RAWG
       rows are correctly deduped. Metroid was cached but never added, so it
       must still come back from the cache with the upstream dead. */
    await page.fill('#discoverSearch', 'Metroid Prime');
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-catalog'));
      const dividers = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-divider'));
      return rows.some((r) => r.textContent.indexOf('Metroid') !== -1) ||
        dividers.some((d) => d.textContent.indexOf('cached') !== -1);
    }, null, { timeout: 8000 });
    const offlineState = await page.evaluate(() => ({
      catalogRows: Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-catalog'))
        .filter((r) => r.textContent.indexOf('Metroid') !== -1).length,
      status: (document.getElementById('catalogSearchStatus') || {}).textContent || '',
      attribution: !!document.querySelector('#discoverSearchResults .gos-search-attribution')
    }));
    check(offlineState.catalogRows >= 1,
      'upstream down: cached catalog results still render (offline fallback)',
      JSON.stringify(offlineState));
    check(offlineState.attribution, 'cached catalog block keeps RAWG attribution', JSON.stringify(offlineState));

    /* 7. Search for a never-cached query with upstream down: honest error, local results still work. */
    await page.fill('#discoverSearch', 'Elden Ring');
    await page.waitForFunction(() => {
      const s = (document.getElementById('catalogSearchStatus') || {}).textContent || '';
      return s.indexOf('unreachable') !== -1;
    }, null, { timeout: 8000 });
    const honest = await page.evaluate(() => ({
      status: (document.getElementById('catalogSearchStatus') || {}).textContent || '',
      localRows: document.querySelectorAll('#discoverSearchResults .gos-search-item-local').length
    }));
    check(honest.status.indexOf('unreachable') !== -1,
      'dead upstream yields honest status, not fake results', JSON.stringify(honest));
    check(honest.localRows >= 1, 'local results survive a dead upstream', JSON.stringify(honest));

    /* 8. E-Day is findable offline in the local graph with verified metadata. */
    await page.fill('#discoverSearch', 'E-Day');
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#discoverSearchResults .gos-search-item-local'));
      return rows.some((r) => r.textContent.indexOf('Gears of War: E-Day') !== -1);
    }, null, { timeout: 5000 });
    const eday = await page.evaluate(() => {
      const ctx = GOS.gos.context();
      /* E-Day is a seed node — it lives in the graph, not the user overlay. */
      const game = (ctx.graph.nodes || []).filter((e) => e.id === 'game:gears-of-war-e-day')[0];
      const edges = (ctx.graph.edges || []).filter((e) => e.source === 'game:gears-of-war-e-day' || e.target === 'game:gears-of-war-e-day');
      return {
        found: !!game,
        released: game && game.metadata ? game.metadata.released : null,
        releaseStatus: game && game.metadata ? game.metadata.releaseStatus : null,
        prequel: edges.filter((e) => e.relationship_type === 'PREQUEL_OF').length,
        coalition: edges.some((e) => e.relationship_type === 'DEVELOPED_BY' && e.target === 'studio:the-coalition'),
        peopleCanFly: edges.some((e) => e.relationship_type === 'DEVELOPED_BY' && e.target === 'studio:people-can-fly')
      };
    });
    check(eday.found && eday.released === '2026-10-06' && eday.releaseStatus === 'released',
      'E-Day seed carries verified release date and status', JSON.stringify(eday));
    check(eday.prequel >= 1, 'E-Day links to Gears of War via PREQUEL_OF', JSON.stringify(eday));
    check(eday.coalition && eday.peopleCanFly, 'E-Day credits The Coalition and People Can Fly', JSON.stringify(eday));

    /* 9. Mobile: search button opens the field and the flow works at 390px. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.click('#mobileSearchBtn');
    const mobileSearch = await page.evaluate(() => {
      const input = document.getElementById('discoverSearch');
      const rect = input.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0, focused: document.activeElement === input, fontSize: getComputedStyle(input).fontSize };
    });
    check(mobileSearch.visible && mobileSearch.focused, 'mobile Search button reveals and focuses the field', JSON.stringify(mobileSearch));
    check(parseInt(mobileSearch.fontSize, 10) >= 16, 'mobile search input avoids iOS zoom (≥16px)', mobileSearch.fontSize);
    await page.fill('#discoverSearch', 'Hades');
    await page.waitForFunction(() => document.querySelectorAll('#discoverSearchResults .gos-search-item-local').length > 0, null, { timeout: 5000 });
    const mobileLocal = await page.evaluate(() => document.querySelectorAll('#discoverSearchResults .gos-search-item-local').length);
    check(mobileLocal >= 1, 'mobile search returns local results', String(mobileLocal));

  } catch (error) {
    failed++;
    console.log('FAIL suite aborted — ' + error.message);
    console.log(error.stack);
  } finally {
    await browser.close();
    app.server.close();
    try { mock.server.close(); } catch (e) { /* already closed */ }
  }

  console.log('========================================================');
  console.log(`CATALOG E2E RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
