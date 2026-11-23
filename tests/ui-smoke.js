'use strict';
/**
 * icyNatural Game OS — browser E2E (flows A..K).
 *
 * Self-contained: starts a local static server, drives Chromium via Playwright,
 * verifies boot, review, multi-experience, discover, filters, library state,
 * taste atlas, feed, surprise-me, export/import and legacy-data safety.
 *
 * Run: npm run test:ui   (or: node tests/ui-smoke.js)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const chromium = require('./playwright-resolve').resolveChromium();

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.GOS_PORT) || 8977;
const BASE = 'http://127.0.0.1:' + PORT;

const problems = [];
const consoleErrors = [];
const badResponses = [];
const dialogs = [];
let passed = 0;

function check(cond, label, detail) {
  if (cond) {
    passed++;
    console.log('PASS ' + label);
  } else {
    const suffix = detail !== undefined ? ' — ' + detail : '';
    problems.push(label + suffix);
    console.log('FAIL ' + label + suffix);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json'
};

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath.endsWith('/')) urlPath += 'index.html';
      const file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end('forbidden'); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; res.end('not found'); return;
      }
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.statusCode = 500; res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const LEGACY_INIT = () => {
  if (!localStorage.getItem('icyNaturalGameOSHistory')) {
    localStorage.setItem('icyNaturalGameOSHistory', JSON.stringify([{
      gameName: 'Halo Infinite', platform: 'PC',
      control: 8, clarity: 7, freedom: 8, expression: 7,
      engagement: 8, depth: 7, flow: 8, intensity: 7, replay: 6,
      friction: [], score: 8, notes: 'legacy entry', time: Date.now()
    }]));
    localStorage.setItem('icyNaturalGameOS', JSON.stringify({
      gameName: 'Halo Infinite', platform: 'PC',
      control: 8, clarity: 7, freedom: 8, expression: 7,
      engagement: 8, depth: 7, flow: 8, intensity: 7, replay: 6,
      notes: 'legacy entry', friction: []
    }));
  }
};

async function waitForBoot(page) {
  await page.waitForFunction(() =>
    window.GOS && GOS.gos && GOS.gos.context().booted === true, null, { timeout: 15000 });
}

async function setScores(page, scores) {
  await page.evaluate((values) => {
    Object.keys(values).forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = String(values[id]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, scores);
}

async function logExperience(page, opts) {
  const before = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.click('.nav-btn[data-tab="test"]');
  await page.waitForSelector('#gameName', { state: 'visible' });
  await page.fill('#gameName', opts.gameName);
  await page.selectOption('#platform', opts.platform || 'PC');
  await setScores(page, opts.scores);
  if (opts.friction) {
    await page.click('#frictionTags .tag >> text=' + opts.friction);
  }
  // reset tag states to neutral, then apply this log's selections deterministically
  await page.evaluate(() => GOS.gos.resetSignalTags());
  for (const tag of (opts.signalTags || [])) {
    for (let i = 0; i < tag.clicks; i++) {
      await page.click('#signalTagGroups .gos-sig-tag >> text=' + tag.text);
    }
  }
  if (opts.context) await page.selectOption('#signalContext', opts.context);
  await page.click('#calculateBtn');
  // saveExperience persisted + calculate flow finished (dashboard active, button re-enabled)
  await page.waitForFunction((n) => GOS.gos.context().experiences.length > n, before,
    { timeout: 15000 });
  await page.waitForFunction(() => {
    const active = document.querySelector('.tab.active');
    const btn = document.getElementById('calculateBtn');
    return !!(active && active.id === 'dashboard' && btn && !btn.disabled);
  }, null, { timeout: 10000 });
}

async function openEntity(page, id) {
  await page.click('.nav-btn[data-tab="discover"]');
  await page.waitForSelector('#discoverSearch', { state: 'visible' });
  await page.fill('#discoverSearch', '');
  await page.evaluate((entityId) => {
    GOS.discover.open(entityId);
  }, id);
  await page.waitForTimeout(150);
}

function countRowsByName(page, selector) {
  return page.$$eval(selector, (rows) =>
    rows.map((row) => {
      const name = row.querySelector('.gos-branch-name');
      return name ? name.textContent : null;
    }).filter(Boolean));
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push(res.status() + ' ' + res.url());
  });
  page.on('dialog', (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });

  await page.addInitScript(LEGACY_INIT);

  /* ============================ A. BOOT ============================ */
  console.log('\n--- A. BOOT ---');
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await waitForBoot(page);

  const boot = await page.evaluate(async () => {
    const ctx = GOS.gos.context();
    const res = await fetch('assets/data/seed-graph.json');
    const json = await res.json();
    return {
      nodes: ctx.graph ? ctx.graph.stats.nodes : 0,
      edges: ctx.graph ? ctx.graph.stats.edges : 0,
      jsonNodes: json.nodes.length,
      jsonEdges: json.edges.length,
      mode: GOS.storage.mode(),
      experiences: ctx.experiences.length,
      migration: GOS.storage.migrationState(),
      legacyHistory: localStorage.getItem('icyNaturalGameOSHistory') !== null,
      legacyLatest: localStorage.getItem('icyNaturalGameOS') !== null
    };
  });
  check(boot.nodes >= 200, 'seed graph built in browser', boot.nodes + ' nodes');
  check(boot.nodes === boot.jsonNodes && boot.edges === boot.jsonEdges,
    'seed JSON and JS global agree', `${boot.nodes}/${boot.jsonNodes} nodes, ${boot.edges}/${boot.jsonEdges} edges`);
  check(boot.mode === 'indexeddb' || boot.mode === 'localstorage', 'storage initialised', boot.mode);
  check(boot.migration.completed === true, 'migration completed');
  check(boot.migration.backupKey || boot.experiences >= 1, 'legacy data imported',
    boot.experiences + ' experience(s) after migration');
  check(boot.legacyHistory && boot.legacyLatest, 'legacy keys present after boot');

  /* ====================== A2. BLANK NEW TEST ====================== */
  console.log('\n--- A2. BLANK NEW TEST ---');
  await page.click('.nav-btn[data-tab="test"]');
  const blankTest = await page.evaluate(() => ({
    gameName: document.getElementById('gameName').value,
    gamePlaceholder: document.getElementById('gameName').placeholder,
    platform: document.getElementById('platform').value,
    platformPlaceholder: document.querySelector('#platform option:checked')?.textContent,
    ratings: Array.from(document.querySelectorAll('.metric-list input[type="range"]')).map((input) => ({
      answered: input.dataset.answered,
      display: document.getElementById(input.id + 'Display')?.textContent
    })),
    notes: document.getElementById('notes').value,
    signals: document.querySelectorAll('.gos-sig-tag.gos-sig-pos, .gos-sig-tag.gos-sig-neg').length,
    friction: document.querySelectorAll('#frictionTags .tag.active').length,
    media: document.getElementById('experienceMediaFile').files.length,
    submitDisabled: document.getElementById('calculateBtn').disabled,
    experiences: GOS.gos.context().experiences.length
  }));
  check(blankTest.gameName === '' && blankTest.gamePlaceholder === 'Enter game name',
    'new test starts with a blank game name and explicit placeholder', JSON.stringify(blankTest));
  check(blankTest.platform === '' && blankTest.platformPlaceholder === 'Select platform',
    'new test starts with no platform selected', JSON.stringify(blankTest));
  check(blankTest.ratings.length === 9 && blankTest.ratings.every((rating) => rating.answered === 'false' && rating.display === 'Unanswered'),
    'all nine new-test ratings are explicitly unanswered, not zero', JSON.stringify(blankTest.ratings));
  check(blankTest.notes === '' && blankTest.signals === 0 && blankTest.friction === 0 && blankTest.media === 0,
    'notes, signals, friction, and media start empty', JSON.stringify(blankTest));
  check(blankTest.submitDisabled, 'submission is disabled while required fields are incomplete');

  await page.fill('#gameName', 'Incomplete Test');
  await page.selectOption('#platform', 'PC');
  await setScores(page, { control: 7, clarity: 7, freedom: 7, expression: 7, engagement: 7, depth: 7, flow: 7, intensity: 7 });
  check(await page.locator('#calculateBtn').isDisabled(), 'submission remains disabled with one unanswered rating');
  await setScores(page, { replay: 7 });
  check(!(await page.locator('#calculateBtn').isDisabled()), 'submission enables only after all required fields are complete');

  const beforeTransientReset = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.click('#signalTagGroups .gos-sig-tag >> nth=0');
  await page.click('#frictionTags .tag >> nth=0');
  await page.setInputFiles('#experienceMediaFile', {
    name: 'fresh-test.png', mimeType: 'image/png', buffer: Buffer.from('fresh test media')
  });
  await page.click('#resetBtn');
  const resetTest = await page.evaluate(() => ({
    gameName: document.getElementById('gameName').value,
    platform: document.getElementById('platform').value,
    unanswered: document.querySelectorAll('.metric-row.is-unanswered').length,
    signals: document.querySelectorAll('.gos-sig-tag.gos-sig-pos, .gos-sig-tag.gos-sig-neg').length,
    friction: document.querySelectorAll('#frictionTags .tag.active').length,
    media: document.getElementById('experienceMediaFile').files.length,
    mediaStatus: document.getElementById('experienceMediaStatus').textContent,
    experiences: GOS.gos.context().experiences.length
  }));
  check(resetTest.gameName === '' && resetTest.platform === '' && resetTest.unanswered === 9,
    'New Blank Test clears only the transient form', JSON.stringify(resetTest));
  check(resetTest.signals === 0 && resetTest.friction === 0 && resetTest.media === 0 && /No media selected/.test(resetTest.mediaStatus),
    'new-test reset clears transient selections and attachments', JSON.stringify(resetTest));
  check(resetTest.experiences === beforeTransientReset,
    'starting a new test preserves saved experiences', `${beforeTransientReset} -> ${resetTest.experiences}`);

  await page.click('#loadDemoBtn');
  const demo = await page.evaluate(() => ({
    activeTab: document.querySelector('.tab.active')?.id,
    gameName: document.getElementById('gameName').value,
    platform: document.getElementById('platform').value,
    answered: document.querySelectorAll('.metric-list input[data-answered="true"]').length,
    notes: document.getElementById('notes').value,
    experiences: GOS.gos.context().experiences.length
  }));
  check(demo.activeTab === 'test' && demo.gameName === 'Hi-Fi Rush' && demo.platform === 'PC' && demo.answered === 9 && demo.notes,
    'Load Demo remains an explicit optional form action', JSON.stringify(demo));
  check(demo.experiences === beforeTransientReset, 'loading demo does not create or delete saved records');
  await page.click('.nav-btn[data-tab="test"]');
  check(await page.inputValue('#gameName') === '' && await page.locator('#calculateBtn').isDisabled(),
    'opening Test Game again starts another blank test');

  /* ============================ B. REVIEW ============================ */
  console.log('\n--- B. REVIEW ---');
  await logExperience(page, {
    gameName: 'Dark Souls',
    scores: { control: 9, clarity: 6, freedom: 8, expression: 9, engagement: 10, depth: 9, flow: 9, intensity: 8, replay: 9 },
    friction: 'Slow',
    context: 'combat',
    signalTags: [
      { text: 'Exploration', clicks: 1 },
      { text: 'Loot satisfaction', clicks: 1 }
    ]
  });

  const review = await page.evaluate(() => {
    const ctx = GOS.gos.context();
    const latest = ctx.experiences.find((e) => e.gameId === 'game:dark-souls');
    const legacy = ctx.experiences.find((e) => e.gameName === 'Halo Infinite');
    return {
      experiences: ctx.experiences.length,
      signals: ctx.signals.length,
      gameId: latest ? latest.gameId : null,
      legacyGameId: legacy ? legacy.gameId : null,
      context: latest && latest.context ? latest.context.mode : null,
      depth: (document.getElementById('resultDepthValue') || {}).textContent || '',
      flow: (document.getElementById('resultFlowValue') || {}).textContent || ''
    };
  });
  check(review.experiences === 2, 'experience saved (1 legacy + 1 new)', String(review.experiences));
  check(review.gameId === 'game:dark-souls', 'game resolved to seed graph', String(review.gameId));
  check(review.legacyGameId === 'game:halo-infinite',
    'legacy record resolves to its seed graph game', String(review.legacyGameId));
  check(review.context === 'combat', 'signal context stored', String(review.context));
  check(review.signals >= 8, 'signals derived from scores/tags/friction', String(review.signals));
  check(/^\d+$/.test(review.depth), 'results show depth value', JSON.stringify(review.depth));
  check(/^\d+$/.test(review.flow), 'results show flow value', JSON.stringify(review.flow));
  check(await page.locator('#resultDepth').count() === 1 && await page.locator('#resultFlow').count() === 1,
    'depth + flow bars present');

  /* ==================== C. MULTIPLE EXPERIENCES ==================== */
  console.log('\n--- C. MULTIPLE EXPERIENCES ---');
  // second log for the SAME game: flips Exploration to negative (Atlas contradiction)
  // and sets clarity to 2 (Atlas negative core pattern)
  await logExperience(page, {
    gameName: 'Dark Souls',
    scores: { control: 8, clarity: 2, freedom: 8, expression: 9, engagement: 9, depth: 9, flow: 8, intensity: 8, replay: 9 },
    context: 'overall',
    signalTags: [
      { text: 'Exploration', clicks: 2 },
      { text: 'Loot satisfaction', clicks: 1 }
    ]
  });

  const multi = await page.evaluate(() => {
    const ctx = GOS.gos.context();
    const darkSouls = ctx.experiences.filter((e) => e.gameId === 'game:dark-souls');
    return {
      total: ctx.experiences.length,
      darkSouls: darkSouls.length,
      distinctIds: new Set(darkSouls.map((e) => e.id)).size
    };
  });
  check(multi.darkSouls === 2, 'two experiences for the same game survive', String(multi.darkSouls));
  check(multi.distinctIds === 2, 'experiences have distinct ids (no name dedupe)', String(multi.distinctIds));
  check(multi.total === 3, 'total = 1 legacy + 2 logged', String(multi.total));

  /* ========================= D. DISCOVER ========================= */
  console.log('\n--- D. DISCOVER ---');
  await page.click('.nav-btn[data-tab="discover"]');
  await page.fill('#discoverSearch', 'Virtua Fighter');
  await page.waitForSelector('#discoverSearchResults .gos-search-item', { timeout: 5000 });
  const searchHits = await page.$$eval('#discoverSearchResults .gos-search-item',
    (items) => items.map((i) => i.textContent));
  check(searchHits.length >= 1, 'search "Virtua Fighter" returns hits', JSON.stringify(searchHits));
  await page.click('#discoverSearchResults .gos-search-item >> nth=0');
  await page.waitForTimeout(150);
  const detailName = await page.locator('#discoverDetail .gos-detail-name').textContent();
  check(/Virtua Fighter/i.test(detailName), 'entity detail renders', detailName);

  const branchGroups = await page.$$eval('#discoverBranches .gos-branch-title',
    (nodes) => nodes.map((n) => n.textContent));
  check(branchGroups.length >= 1, 'first-degree branches render', JSON.stringify(branchGroups));

  await page.selectOption('#discoverDepth', '2');
  await page.waitForSelector('#discoverExpansion .gos-expansion-summary', { timeout: 5000 });
  const depth2 = await page.locator('#discoverExpansion .gos-expansion-summary').textContent();
  check(/Depth 2/.test(depth2), 'expansion depth 2', depth2.slice(0, 70));

  let depth3ok = false;
  let depth3 = '';
  try {
    await page.selectOption('#discoverDepth', '3');
    await page.waitForSelector('#discoverExpansion .gos-expansion-summary:has-text("Depth 3")',
      { timeout: 8000 });
    depth3 = await page.locator('#discoverExpansion .gos-expansion-summary').textContent();
    depth3ok = /Depth 3/.test(depth3);
  } catch (error) {
    depth3 = String(error).slice(0, 160);
  }
  check(depth3ok, 'expansion depth 3 completes without freezing (cycle-safe)', depth3.slice(0, 70));

  // expand rows carry a path label (traversal evidence)
  const expansionPaths = await page.$$eval('#discoverExpansion .gos-branch-item',
    (rows) => rows.slice(0, 5).map((r) => {
      const label = r.querySelector('.gos-branch-label');
      return label ? label.textContent : '';
    }));
  check(expansionPaths.length >= 1 && expansionPaths.some((p) => p.length > 0),
    'expansion shows hop path labels', JSON.stringify(expansionPaths.slice(0, 2)));

  // breadcrumb navigation
  const beforeName = await page.locator('#discoverDetail .gos-detail-name').textContent();
  await page.click('#discoverBranches .gos-branch-open >> nth=0');
  await page.waitForTimeout(150);
  const afterName = await page.locator('#discoverDetail .gos-detail-name').textContent();
  const crumbs = await page.$$eval('#discoverBreadcrumb .gos-crumb', (c) => c.length);
  check(crumbs >= 1 && afterName !== beforeName, 'branch click navigates and pushes breadcrumb',
    `${beforeName} -> ${afterName}, crumbs=${crumbs}`);
  await page.click('#discoverBreadcrumb .gos-crumb >> nth=0');
  await page.waitForTimeout(150);
  const backName = await page.locator('#discoverDetail .gos-detail-name').textContent();
  check(backName === beforeName, 'breadcrumb back works', `${backName}`);

  /* ========================== E. FILTERS ========================== */
  console.log('\n--- E. FILTERS ---');
  await page.fill('#discoverSearch', 'FromSoftware');
  await page.waitForSelector('#discoverSearchResults .gos-search-item', { timeout: 5000 });
  const fromSoftwareHit = await page.locator(
    '#discoverSearchResults .gos-search-item[data-id="studio:from-software"]').count();
  check(fromSoftwareHit === 1, 'search finds the FromSoftware studio by id');
  await page.click('#discoverSearchResults .gos-search-item[data-id="studio:from-software"]');
  await page.waitForTimeout(150);
  check((await page.locator('#discoverDetail .gos-detail-name').textContent()) === 'FromSoftware',
    'navigated to FromSoftware studio');

  // person filter — semantic: every game row really connects to the person
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Person") select',
    'person:hidetaka-miyazaki');
  await page.waitForTimeout(150);
  const personCheck = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const connected = (a, b) =>
      (g.out[a] || []).some((e) => e.target === b) || (g.in[a] || []).some((e) => e.source === b);
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    const bad = games.filter((n) => !connected(n.id, 'person:hidetaka-miyazaki'));
    const types = rows.map(nodeByName).filter(Boolean).map((n) => n.type);
    return { rows: rows.length, games: games.length, bad: bad.map((n) => n.name), types };
  });
  check(personCheck.games >= 4, 'person filter shows Miyazaki games', String(personCheck.games));
  check(personCheck.bad.length === 0, 'every filtered game connects to the person',
    JSON.stringify(personCheck.bad));
  check(!personCheck.types.includes('platform') && !personCheck.types.includes('mechanic'),
    'content filters hide unrelated entity types', JSON.stringify(personCheck.types));

  // studio filter
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Person") select', '');
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Studio") select',
    'studio:from-software');
  await page.waitForTimeout(150);
  const studioCheck = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const connected = (a, b) =>
      (g.out[a] || []).some((e) => e.target === b) || (g.in[a] || []).some((e) => e.source === b);
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    const bad = games.filter((n) => !connected(n.id, 'studio:from-software'));
    return { games: games.length, bad: bad.map((n) => n.name) };
  });
  check(studioCheck.games >= 5, 'studio filter shows the studio games', String(studioCheck.games));
  check(studioCheck.bad.length === 0, 'every filtered game connects to the studio',
    JSON.stringify(studioCheck.bad));

  // franchise filter
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Studio") select', '');
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Franchise") select',
    'franchise:dark-souls');
  await page.waitForTimeout(150);
  const franchiseCheck = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const connected = (a, b) =>
      (g.out[a] || []).some((e) => e.target === b) || (g.in[a] || []).some((e) => e.source === b);
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    const bad = games.filter((n) => !connected(n.id, 'franchise:dark-souls'));
    const franchiseNodes = rows.map(nodeByName).filter((n) => n && n.type === 'franchise');
    return { games: games.length, bad: bad.map((n) => n.name), franchises: franchiseNodes.map((n) => n.id) };
  });
  check(franchiseCheck.games >= 1, 'franchise filter shows franchise games', String(franchiseCheck.games));
  check(franchiseCheck.bad.length === 0, 'every filtered game belongs to the franchise',
    JSON.stringify(franchiseCheck.bad));
  check(franchiseCheck.franchises.every((id) => id === 'franchise:dark-souls'),
    'only the selected franchise node appears', JSON.stringify(franchiseCheck.franchises));

  // platform filter — pick a platform the studio's games actually ship on
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Franchise") select', '');
  const platformValue = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const studioGames = (g.in['studio:from-software'] || []).map((e) => e.source)
      .concat((g.out['studio:from-software'] || []).map((e) => e.target))
      .filter((id) => id.indexOf('game:') === 0);
    for (const gid of studioGames) {
      const edge = (g.out[gid] || []).find((e) => e.relationship_type === 'AVAILABLE_ON');
      if (edge) return edge.target;
    }
    return null;
  });
  check(!!platformValue, 'found a platform used by studio games', String(platformValue));
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Platform") select',
    platformValue);
  await page.waitForTimeout(150);
  const platformCheck = await page.evaluate((platformId) => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const connected = (a, b) =>
      (g.out[a] || []).some((e) => e.target === b) || (g.in[a] || []).some((e) => e.source === b);
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    const bad = games.filter((n) => !connected(n.id, platformId));
    return { games: games.length, bad: bad.map((n) => n.name) };
  }, platformValue);
  check(platformCheck.games >= 1, 'platform filter shows games on the platform',
    `${platformCheck.games} games`);
  check(platformCheck.bad.length === 0, 'every filtered game runs on the platform',
    JSON.stringify(platformCheck.bad));

  // under a game root the platform node itself must appear
  await openEntity(page, 'game:dark-souls');
  await page.waitForTimeout(150);
  const platformNodeCheck = await page.evaluate((platformId) => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    return rows.map(nodeByName).filter(Boolean).map((n) => n.id);
  }, platformValue);
  check(platformNodeCheck.includes(platformValue),
    'platform node appears under a game root', JSON.stringify(platformNodeCheck));
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Platform") select', '');

  // mechanic filter — semantic: only direct USES_MECHANIC games pass
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Platform") select', '');
  const firstMechanic = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const edge = (g.out['game:dark-souls'] || []).find((e) => e.relationship_type === 'USES_MECHANIC');
    return edge ? edge.target : null;
  });
  check(!!firstMechanic, 'dark souls has a mechanic to filter by', String(firstMechanic));
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Mechanic") select',
    firstMechanic);
  await openEntity(page, 'game:dark-souls');
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Mechanic") select',
    firstMechanic);
  await page.waitForTimeout(150);
  const mechanicCheck = await page.evaluate((mechanicId) => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const usesMechanic = (gameId) =>
      (g.out[gameId] || []).some((e) =>
        e.relationship_type === 'USES_MECHANIC' && e.target === mechanicId);
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    const bad = games.filter((n) => !usesMechanic(n.id));
    const mechanics = rows.map(nodeByName).filter((n) => n && n.type === 'mechanic');
    return {
      games: games.length,
      bad: bad.map((n) => n.name),
      mechanics: mechanics.map((n) => n.id)
    };
  }, firstMechanic);
  check(mechanicCheck.mechanics.includes(firstMechanic),
    'mechanic filter keeps the mechanic itself', JSON.stringify(mechanicCheck.mechanics));
  check(mechanicCheck.bad.length === 0,
    'mechanic filter admits only games with a direct USES_MECHANIC edge',
    JSON.stringify(mechanicCheck.bad));

  // lineage category chip: only lineage groups remain
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Mechanic") select', '');
  await page.click('#discoverFilters .gos-filter-chips .gos-chip >> text=Franchise lineage');
  await page.waitForTimeout(150);
  const lineageCheck = await page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-title'))
      .map((n) => n.textContent);
    return {
      titles,
      notLineage: document.querySelectorAll('#discoverBranches .gos-not-lineage').length
    };
  });
  check(lineageCheck.titles.length >= 1, 'lineage chip leaves a lineage group',
    JSON.stringify(lineageCheck.titles));
  check(lineageCheck.notLineage === 0, 'non-lineage groups hidden under lineage chip',
    String(lineageCheck.notLineage));
  await page.click('#discoverFilters .gos-filter-chips .gos-chip >> text=Franchise lineage');

  // playability + mode
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Playability") select',
    'current');
  await page.waitForTimeout(150);
  const playabilityCheck = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    return {
      games: games.length,
      bad: games.filter((n) => n.metadata && n.metadata.playability !== 'current').map((n) => n.name)
    };
  });
  check(playabilityCheck.games >= 1 && playabilityCheck.bad.length === 0,
    'playability filter: all rows playable now',
    `${playabilityCheck.games} games, bad=${JSON.stringify(playabilityCheck.bad)}`);

  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Playability") select', 'any');
  await page.selectOption('#discoverFilters .gos-filter-field:has-text("Mode") select', 'single');
  await page.waitForTimeout(150);
  const modeCheck = await page.evaluate(() => {
    const g = GOS.gos.context().graph;
    const rows = Array.from(document.querySelectorAll('#discoverBranches .gos-branch-item'))
      .map((row) => row.querySelector('.gos-branch-name').textContent);
    const nodeByName = (name) => g.byKey[GOS.util.normalizeKey(name)] || null;
    const games = rows.map(nodeByName).filter((n) => n && n.type === 'game');
    return {
      games: games.length,
      bad: games.filter((n) => !(n.metadata && (n.metadata.modes || []).includes('single')))
        .map((n) => n.name)
    };
  });
  check(modeCheck.games >= 1 && modeCheck.bad.length === 0,
    'mode filter: all rows are single-player',
    `${modeCheck.games} games, bad=${JSON.stringify(modeCheck.bad)}`);

  await page.click('#discoverFilters .gos-filter-reset');
  await page.waitForTimeout(150);

  /* ======================== F. LIBRARY STATE ======================== */
  console.log('\n--- F. LIBRARY STATE ---');
  await page.fill('#discoverSearch', 'Virtua Fighter 5');
  await page.waitForSelector('#discoverSearchResults .gos-search-item', { timeout: 5000 });
  await page.click('#discoverSearchResults .gos-search-item[data-id="game:virtua-fighter-5"]');
  await page.waitForTimeout(200);
  await page.selectOption('#discoverDetail .gos-library-field select', 'backlog');
  await page.waitForFunction(() =>
    document.querySelector('#discoverDetail .gos-meta-chip') &&
    Array.from(document.querySelectorAll('#discoverDetail .gos-meta-chip'))
      .some((chip) => /status: backlog/.test(chip.textContent)), null, { timeout: 5000 });
  check(true, 'library status set to backlog (UI reflects it)');

  await page.reload({ waitUntil: 'networkidle' });
  await waitForBoot(page);
  await page.click('.nav-btn[data-tab="discover"]');
  await page.fill('#discoverSearch', 'Virtua Fighter 5');
  await page.waitForSelector('#discoverSearchResults .gos-search-item', { timeout: 5000 });
  await page.click('#discoverSearchResults .gos-search-item[data-id="game:virtua-fighter-5"]');
  await page.waitForTimeout(200);
  const persistedStatus = await page.evaluate(() => {
    const entry = GOS.gos.context().library.find((l) => l.gameId === 'game:virtua-fighter-5');
    return entry ? entry.status : null;
  });
  check(persistedStatus === 'backlog', 'library status survives reload', String(persistedStatus));

  /* ========================= G. TASTE ATLAS ========================= */
  console.log('\n--- G. TASTE ATLAS ---');
  await page.click('.nav-btn[data-tab="atlas"]');
  await page.waitForSelector('#atlasSections .gos-atlas-section', { timeout: 5000 });

  const atlas = await page.evaluate(() => {
    const sectionByTitle = (title) => {
      const head = Array.from(document.querySelectorAll('#atlasSections .gos-atlas-section-title'))
        .find((n) => n.textContent === title);
      return head ? head.closest('.gos-atlas-section') : null;
    };
    const strongPos = sectionByTitle('Strong positive');
    const strongNeg = sectionByTitle('Strong negative');
    const contra = sectionByTitle('Contradictions');
    const core = sectionByTitle('Core dimensions');
    const patternsOf = (section) => section
      ? Array.from(section.querySelectorAll('.gos-pattern')).map((p) => ({
          label: p.querySelector('.gos-pattern-title').textContent,
          cls: p.className,
          chips: Array.from(p.querySelectorAll('.gos-pattern-chips .gos-chip'))
            .map((c) => c.textContent)
        }))
      : [];
    return {
      strongPositive: patternsOf(strongPos),
      strongNegative: patternsOf(strongNeg),
      contradictions: patternsOf(contra),
      core: patternsOf(core)
    };
  });
  check(atlas.strongPositive.length >= 1, 'positive pattern appears',
    atlas.strongPositive.map((p) => p.label).join(', ').slice(0, 80));
  const coreNegative = atlas.core.filter((p) => p.cls.includes('gos-pattern-negative'));
  check(coreNegative.length >= 1, 'negative pattern appears',
    coreNegative.map((p) => p.label).join(', ').slice(0, 80));
  check(atlas.contradictions.length >= 1, 'contradiction appears when evidence conflicts',
    atlas.contradictions.map((p) => p.label).join(', ').slice(0, 80));
  check(await page.locator('#tasteGlyph .taste-dimension').count() === 9,
    'Taste Interpretation shows all nine mapped dimensions');
  check(await page.locator('#tasteGlyph .taste-dimension .gos-chip-pos').count() >= 1 &&
    await page.locator('#tasteGlyph .taste-dimension .gos-chip-neg').count() >= 1,
    'Taste Interpretation identifies highest and lowest dimensions');
  await page.locator('#tasteGlyph .taste-dimension[data-glyph-dimension="depth"]').click();
  check(await page.locator('#tasteGlyph .experience-radar__sector[data-glyph-dimension="depth"].is-dimension-active').count() === 1,
    'Taste dimension tap highlights the matching radar axis');
  check(/7\.5\/10/.test(await page.locator('#tasteGlyph').textContent()),
    'positive-experience threshold is documented in the panel');
  await page.locator('#tasteGlyph .taste-positive-toggle').click();
  check(await page.locator('#tasteGlyph .experience-glyph').count() === 2,
    'optional positive-experience glyph renders on request');
  await page.locator('#tasteGlyph .taste-positive-toggle').click();

  const contradiction = atlas.contradictions[0];
  const honestConf = contradiction.chips.every((chip) => chip !== 'well supported');
  check(honestConf, 'confidence does not overstate sparse evidence',
    JSON.stringify(contradiction.chips));

  // expand the contradiction and verify supporting + contradicting evidence.
  // Click + read happen in ONE evaluate (atomic) because the gos:tab handler
  // re-renders the atlas asynchronously and would reset the expansion.
  const evidence = await page.evaluate(() => {
    const head = Array.from(document.querySelectorAll('#atlasSections .gos-atlas-section-title'))
      .find((n) => n.textContent === 'Contradictions');
    const section = head ? head.closest('.gos-atlas-section') : null;
    if (!section) return { items: 0, contradicting: '' };
    const button = section.querySelector('.gos-pattern-head');
    if (button) button.click();
    const body = section.querySelector('.gos-pattern-body');
    if (!body || body.classList.contains('hidden')) return { items: -1, contradicting: '' };
    return {
      items: body.querySelectorAll('.gos-evidence-item').length,
      contradicting: (body.querySelector('.gos-contradicting') || {}).textContent || ''
    };
  });
  check(evidence.items >= 1, 'supporting experiences visible after expand', String(evidence.items));
  check(/Dark Souls/.test(evidence.contradicting),
    'contradicting experiences visible', evidence.contradicting.slice(0, 60));

  /* ====================== H. FEED / RECOMMENDATIONS ====================== */
  console.log('\n--- H. FEED / RECOMMENDATIONS ---');
  await page.click('.nav-btn[data-tab="feed"]');
  await page.waitForSelector('#recommendList .gos-rec-card, #recommendList .gos-empty',
    { timeout: 5000 });
  const feed = await page.evaluate(() => ({
    cards: document.querySelectorAll('#recommendList .gos-rec-card').length,
    reasons: document.querySelectorAll('#recommendList .gos-reason').length,
    evidenceChips: document.querySelectorAll('#recommendList .gos-reason-evidence .gos-chip').length
  }));
  check(feed.cards >= 1, 'recommendations render', String(feed.cards));
  check(feed.reasons >= feed.cards, 'every recommendation carries reasons', String(feed.reasons));
  check(feed.evidenceChips >= 1, 'supporting evidence renders', String(feed.evidenceChips));

  const firstRec = await page.locator('#recommendList .gos-rec-title >> nth=0').textContent();
  await page.click('#recommendList .gos-rec-title >> nth=0');
  await page.waitForTimeout(250);
  const openedName = await page.locator('#discoverDetail .gos-detail-name').textContent();
  const discoverActive = await page.evaluate(() => {
    const active = document.querySelector('.tab.active');
    return active ? active.id : null;
  });
  check(discoverActive === 'discover', 'recommendation opens the Discover tab', String(discoverActive));
  check(openedName === firstRec, 'recommendation opens its entity',
    `${firstRec} vs ${openedName}`);

  /* ========================= I. SURPRISE ME ========================= */
  console.log('\n--- I. SURPRISE ME ---');
  await page.click('.nav-btn[data-tab="feed"]');
  await page.waitForSelector('#surpriseBtn', { state: 'visible' });
  await page.click('#surpriseBtn');
  await page.waitForSelector('#surprisePanel .gos-rec-card, #surprisePanel .gos-empty',
    { timeout: 5000 });
  const surpriseDom = await page.evaluate(() => ({
    cards: document.querySelectorAll('#surprisePanel .gos-rec-card').length,
    paths: document.querySelectorAll('#surprisePanel .gos-path').length,
    note: (document.querySelector('#surprisePanel .gos-empty') || {}).textContent || null
  }));
  check(surpriseDom.cards >= 1 && !surpriseDom.note, 'surprise me produces a candidate',
    surpriseDom.note || (surpriseDom.cards + ' cards'));
  check(surpriseDom.paths >= 1, 'candidate includes a real graph path', String(surpriseDom.paths));

  const surpriseSemantics = await page.evaluate(() => {
    const ctx = GOS.gos.context();
    const played = new Set(ctx.experiences.map((e) => e.gameId));
    const state = {
      graph: ctx.graph, experiences: ctx.experiences, library: ctx.library,
      games: ctx.games, patterns: ctx.patterns
    };
    const result = GOS.recommend.surprise(state, { limit: 3, pick: 0 });
    const validTypes = new Set(GOS.recommend.PATH_EDGE_TYPES);
    const problemsFound = [];
    result.items.forEach((item) => {
      if (played.has(item.gameId)) problemsFound.push('played game returned: ' + item.gameId);
      if (item.depth < 1 || item.depth > 3) problemsFound.push('depth out of bounds: ' + item.depth);
      for (let i = 0; i + 1 < item.path.length; i++) {
        const a = item.path[i];
        const b = item.path[i + 1];
        const edge = ctx.graph.edges.find((e) =>
          (e.source === a && e.target === b) || (e.source === b && e.target === a));
        if (!edge) problemsFound.push('no edge between ' + a + ' and ' + b);
        else if (!validTypes.has(edge.relationship_type)) {
          problemsFound.push('invalid path edge type ' + edge.relationship_type);
        }
      }
      const loveScore = ctx.experiences
        .filter((e) => e.gameId === item.gameId)
        .map((e) => e.score);
      if (loveScore.some((s) => s >= 7.5)) {
        problemsFound.push('known favourite returned as novel: ' + item.gameId);
      }
    });
    return {
      items: result.items.length,
      seeds: result.seeds.map((s) => s.name),
      problems: problemsFound
    };
  });
  check(surpriseSemantics.items >= 1, 'surprise semantics: candidates exist',
    String(surpriseSemantics.items));
  check(surpriseSemantics.problems.length === 0,
    'surprise paths use valid edge types and exclude known history',
    JSON.stringify(surpriseSemantics.problems));

  /* ======================== J. EXPORT / IMPORT ======================== */
  console.log('\n--- J. EXPORT / IMPORT ---');
  await page.click('.nav-btn[data-tab="settings"]');
  await page.waitForSelector('#exportDataBtn', { state: 'visible' });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#exportDataBtn')
  ]);
  const downloadPath = await download.path();
  const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
  check(exported.format === 'icyNaturalGameOS.export', 'export format', String(exported.format));
  check(Array.isArray(exported.collections.experiences) && exported.collections.experiences.length >= 3,
    'export contains experiences', String((exported.collections.experiences || []).length));
  check(Array.isArray(exported.collections.library) && exported.collections.library.length >= 1,
    'export contains library', String((exported.collections.library || []).length));
  check(exported.legacy && typeof exported.legacy.history === 'string',
    'export documents legacy keys');

  // valid import
  dialogs.length = 0;
  exported.collections.experiences.push({
    id: 'exp:ui-import', gameId: 'game:imported', gameName: 'Imported Game',
    scores: { control: 7, clarity: 7, freedom: 7, expression: 7, engagement: 7, depth: 7, flow: 7, intensity: 7, replay: 7 },
    score: 7, verdict: 'positive', friction: [], notes: '',
    context: { mode: 'overall' }, signals: [],
    created_at: new Date().toISOString()
  });
  await page.setInputFiles('#importDataFile', {
    name: 'valid-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported))
  });
  await page.waitForFunction(() =>
    GOS.gos.context().experiences.some((e) => e.id === 'exp:ui-import'),
    null, { timeout: 8000 }).catch(() => {});
  const afterValidImport = await page.evaluate(() => ({
    present: GOS.gos.context().experiences.some((e) => e.id === 'exp:ui-import'),
    count: GOS.gos.context().experiences.length
  }));
  const validDialog = dialogs.find((d) => /Import complete/.test(d.message));
  check(!!validDialog, 'valid import accepted with confirmation',
    JSON.stringify(dialogs.map((d) => d.message)));
  check(afterValidImport.present, 'imported record present after import',
    String(afterValidImport.count));

  // malformed import (bad JSON) — rejected, nothing written
  dialogs.length = 0;
  const beforeBad = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.setInputFiles('#importDataFile', {
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format": "icyNaturalGameOS.export", "collect')
  });
  await page.waitForFunction(() =>
    document.querySelectorAll('body > dialog[open]').length >= 0, null, { timeout: 3000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  const badDialog = dialogs.find((d) => /rejected|valid JSON/i.test(d.message));
  check(!!badDialog, 'malformed import rejected safely',
    JSON.stringify(dialogs.map((d) => d.message)));
  const afterBad = await page.evaluate(() => GOS.gos.context().experiences.length);
  check(afterBad === beforeBad, 'malformed import writes nothing',
    `${beforeBad} -> ${afterBad}`);

  // wrong-format import — also rejected
  dialogs.length = 0;
  await page.setInputFiles('#importDataFile', {
    name: 'wrong-format.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'something-else', schemaVersion: 1, collections: {} }))
  });
  await page.waitForTimeout(500);
  check(dialogs.some((d) => /rejected/i.test(d.message)), 'wrong format rejected',
    JSON.stringify(dialogs.map((d) => d.message)));

  // persistence after reload
  await page.reload({ waitUntil: 'networkidle' });
  await waitForBoot(page);
  const afterReload = await page.evaluate(() => ({
    imported: GOS.gos.context().experiences.some((e) => e.id === 'exp:ui-import'),
    count: GOS.gos.context().experiences.length
  }));
  check(afterReload.imported, 'imported data persists after reload', String(afterReload.count));

  /* ======================== K. LEGACY SAFETY ======================== */
  console.log('\n--- K. LEGACY SAFETY ---');
  const legacy = await page.evaluate(() => {
    const read = (key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch (e) { return raw; }
    };
    const history = read('icyNaturalGameOSHistory');
    return {
      historyExists: history !== null,
      latestExists: localStorage.getItem('icyNaturalGameOS') !== null,
      originalKept: Array.isArray(history) &&
        history.some((h) => h.gameName === 'Halo Infinite'),
      mirrored: Array.isArray(history) &&
        history.some((h) => h.__experienceId),
      count: Array.isArray(history) ? history.length : 0,
      keys: Object.keys(localStorage).filter((k) => /icyNaturalGameOS/.test(k))
    };
  });
  check(legacy.historyExists, 'icyNaturalGameOSHistory never deleted');
  check(legacy.latestExists, 'icyNaturalGameOS never deleted');
  check(legacy.originalKept, 'original legacy entry still present after all operations');
  check(legacy.mirrored, 'legacy mirror updated with structured experiences',
    legacy.count + ' entries');
  check(legacy.keys.some((k) => /^icyNaturalGameOSBackup\./.test(legacy.keys.join('|')) ) ||
    legacy.keys.length >= 3, 'migration/backup state keys present', JSON.stringify(legacy.keys));

  const settingsStatus = await page.evaluate(async () => {
    const storage = document.getElementById('storageStatus');
    const migration = document.getElementById('migrationStatus');
    return { storage: storage.textContent, migration: migration.textContent };
  });
  check(/Storage: (indexeddb|localstorage)/.test(settingsStatus.storage),
    'storage status renders', settingsStatus.storage);
  check(/Migration: completed/.test(settingsStatus.migration),
    'migration status renders', settingsStatus.migration.slice(0, 70));

  /* ======================== L. GLYPHS / MEDIA / RESPONSIVE ======================== */
  console.log('\n--- L. GLYPHS / MEDIA / RESPONSIVE ---');
  await page.click('.nav-btn[data-tab="dashboard"]');
  const glyphSurfaces = await page.evaluate(() => ({
    dashboard: document.querySelectorAll('#dashboardGlyph .experience-glyph svg').length,
    history: document.querySelectorAll('#recentGamesList .history-glyph svg').length,
    title: document.querySelector('#dashboardGlyph svg title')?.textContent || '',
    desc: document.querySelector('#dashboardGlyph svg desc')?.textContent || ''
  }));
  check(glyphSurfaces.dashboard === 1, 'dashboard renders a real SVG experience glyph');
  check(glyphSurfaces.history >= 1, 'recent history renders session glyphs');
  check(/glyph, score/i.test(glyphSurfaces.title) && /Control/i.test(glyphSurfaces.desc),
    'glyph exposes accessible numeric alternatives', JSON.stringify(glyphSurfaces));
  const radarStructure = await page.evaluate(() => ({
    sessionVariant: document.querySelector('#dashboardGlyph svg')?.dataset.variant,
    scale: document.querySelector('#dashboardGlyph svg')?.dataset.scale,
    fill: document.querySelectorAll('#dashboardGlyph .experience-radar__fill').length,
    outline: document.querySelectorAll('#dashboardGlyph .experience-radar__outline').length,
    dots: document.querySelectorAll('#dashboardGlyph .experience-radar__dot').length,
    rings: Array.from(document.querySelectorAll('#dashboardGlyph .experience-radar__ring'))
      .map((ring) => ring.dataset.ring),
    labels: document.querySelectorAll('#dashboardGlyph .experience-radar__label').length,
    historyText: document.querySelectorAll('#recentGamesList .experience-glyph__score').length,
    historyFilters: document.querySelectorAll('#recentGamesList svg filter').length
  }));
  check(radarStructure.sessionVariant === 'session' && radarStructure.scale === '0-10' &&
    radarStructure.fill === 1 && radarStructure.outline === 1 && radarStructure.dots === 9,
    'session glyph is one filled nine-axis radar on a fixed 0–10 scale', JSON.stringify(radarStructure));
  check(JSON.stringify(radarStructure.rings) === JSON.stringify(['2', '4', '6', '8', '10']),
    'subtle concentric nine-sided reference rings mark the shared scale',
    JSON.stringify(radarStructure.rings));
  check(radarStructure.labels === 9,
    'dashboard glyph names all nine dimensions around the perimeter');
  check(radarStructure.historyText === 0 && radarStructure.historyFilters === 0,
    'small history glyphs drop labels and effects instead of shrinking hero treatment');

  await page.click('.nav-btn[data-tab="results"]');
  const radarArt = await page.evaluate(() => {
    const art = document.querySelector('#resultGlyph .experience-radar__art');
    return {
      viewBox: art?.getAttribute('viewBox') || '',
      scale: art?.dataset.scale,
      width: Math.round(art?.getBoundingClientRect().width || 0),
      labels: document.querySelectorAll('#resultGlyph .experience-radar__label').length,
      labelNames: Array.from(document.querySelectorAll('#resultGlyph .experience-radar__label'))
        .map((node) => node.textContent),
      dots: document.querySelectorAll('#resultGlyph .experience-radar__dot').length,
      sectors: document.querySelectorAll('#resultGlyph .experience-radar__sector').length
    };
  });
  check(radarArt.viewBox === '-34 -10 268 220' && radarArt.scale === '0-10',
    'results radar keeps the fixed labelled viewBox and shared scale', JSON.stringify(radarArt));
  check(radarArt.width >= 490,
    'results radar keeps the large visually dominant desktop scale', JSON.stringify(radarArt));
  check(radarArt.labels === 9 && radarArt.sectors === 9 && radarArt.dots === 9,
    'results radar exposes nine labelled, tappable axes', JSON.stringify(radarArt));
  check(radarArt.labelNames.join(',') ===
    'Control,Clarity,Freedom,Expression,Engagement,Depth,Flow,Intensity,Replay Pull',
    'dimension order and names stay identical across every chart', JSON.stringify(radarArt.labelNames));

  const desktopLabelSpacing = await page.evaluate(() => {
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const svg = document.querySelector('#resultGlyph .experience-radar__art');
    const matrix = svg.getScreenCTM();
    const center = new DOMPoint(100, 100).matrixTransform(matrix);
    const radius = 84 * Math.abs(matrix.a);
    const labels = Array.from(document.querySelectorAll('#resultGlyph .experience-radar__label')).map((node) => node.getBoundingClientRect());
    const clearsGlyph = (box) => {
      const closestX = Math.max(box.left, Math.min(center.x, box.right));
      const closestY = Math.max(box.top, Math.min(center.y, box.bottom));
      return Math.hypot(closestX - center.x, closestY - center.y) >= radius;
    };
    let pairwise = 0;
    labels.forEach((box, index) => labels.slice(index + 1).forEach((other) => { if (overlap(box, other)) pairwise++; }));
    return { pairwise, glyph: labels.filter((box) => !clearsGlyph(box)).length };
  });
  check(desktopLabelSpacing.pairwise === 0 && desktopLabelSpacing.glyph === 0,
    'desktop perimeter labels overlap neither one another nor the radar', JSON.stringify(desktopLabelSpacing));

  const outlineBeforeHover = await page.locator('#resultGlyph .experience-radar__outline').getAttribute('points');
  await page.locator('#resultGlyph [data-glyph-dimension="depth"].experience-radar__label').hover();
  const linkedHighlight = await page.evaluate(() => ({
    label: document.querySelector('#resultGlyph .experience-radar__label[data-glyph-dimension="depth"]')?.classList.contains('is-dimension-active'),
    axis: document.querySelector('#resultGlyph .experience-radar__axis[data-glyph-dimension="depth"]')?.classList.contains('is-dimension-active'),
    sector: document.querySelector('#resultGlyph .experience-radar__sector[data-glyph-dimension="depth"]')?.classList.contains('is-dimension-active'),
    bar: document.querySelector('.results-dimensions [data-glyph-dimension="depth"]')?.classList.contains('is-dimension-active'),
    tip: document.querySelector('#resultGlyph .experience-glyph__tip')?.textContent || '',
    tipHidden: document.querySelector('#resultGlyph .experience-glyph__tip')?.hidden !== false
  }));
  check(linkedHighlight.label && linkedHighlight.axis && linkedHighlight.sector && linkedHighlight.bar,
    'label hover synchronizes the radar highlight and dimension bar', JSON.stringify(linkedHighlight));
  check(!linkedHighlight.tipHidden && /Depth/.test(linkedHighlight.tip) && /\/ 10/.test(linkedHighlight.tip),
    'hovering a point reports its dimension and exact score', JSON.stringify(linkedHighlight.tip));
  check(await page.locator('#resultGlyph .experience-radar__outline').getAttribute('points') === outlineBeforeHover,
    'highlighting never changes the score polygon geometry');
  await page.locator('#resultGlyph [data-glyph-dimension="depth"].experience-radar__label').click();
  check(await page.locator('.results-dimensions [data-glyph-dimension="depth"].is-dimension-active').count() === 1,
    'label tap/click pins the corresponding dimension highlight');
  await page.locator('#resultGlyph [data-glyph-dimension="depth"].experience-radar__label').click();
  check(await page.locator('.results-dimensions [data-glyph-dimension="depth"].is-dimension-active').count() === 0,
    'tapping the pinned dimension again releases the highlight');

  await page.click('.nav-btn[data-tab="atlas"]');
  await page.waitForSelector('#tasteGlyph .experience-glyph');
  check(await page.locator('#tasteGlyph .experience-glyph').count() === 1,
    'Taste Atlas renders separately aggregated taste glyph');
  check(await page.locator('#tasteGlyph svg[data-variant="taste"]').count() === 1,
    'Taste glyph uses its distinct structural variant');

  await openEntity(page, 'game:dark-souls');
  const dossier = await page.evaluate(() => ({
    exists: !!document.querySelector('.game-dossier'),
    dimensions: document.querySelectorAll('.game-dossier .glyph-dimension').length,
    sessions: document.querySelectorAll('.game-dossier .dossier-session').length,
    similarityCards: document.querySelectorAll('.game-dossier .similar-glyph-card').length,
    noFakeMedia: /never uploads automatically|No media attached/.test(document.querySelector('.game-dossier')?.textContent || '')
  }));
  check(dossier.exists, 'reviewed game opens the cinematic experience dossier');
  check(dossier.dimensions === 9, 'game dossier preserves all nine dimensions', String(dossier.dimensions));
  check(dossier.sessions >= 2, 'game dossier shows recorded session history', String(dossier.sessions));
  check(dossier.noFakeMedia, 'unavailable media is represented honestly');
  check(await page.locator('.game-dossier svg[data-variant="game"]').count() >= 1,
    'game aggregate uses its distinct radar variant');

  const sharedScale = await page.evaluate(() => {
    const arts = Array.from(document.querySelectorAll('.game-dossier .experience-radar__art'));
    return {
      count: arts.length,
      viewBoxes: Array.from(new Set(arts.map((art) => art.getAttribute('viewBox')))),
      scales: Array.from(new Set(arts.map((art) => art.dataset.scale)))
    };
  });
  check(sharedScale.count >= 3 && sharedScale.viewBoxes.length === 1 &&
    sharedScale.scales.length === 1 && sharedScale.scales[0] === '0-10',
    'hero, comparison and session glyphs share one identical fixed scale',
    JSON.stringify(sharedScale));

  await openEntity(page, 'game:virtua-fighter-5');
  const invented = await page.evaluate(() => !!document.querySelector('.game-dossier'));
  check(invented === false, 'unreviewed games never receive invented glyph evidence');

  const privacy = await page.evaluate(async () => {
    const blob = new Blob(['private bytes'], { type: 'video/webm' });
    Object.defineProperty(blob, 'name', { value: 'private-test.webm' });
    const record = GOS.media.metadata(blob, { id: 'media:ui-private', gameId: 'game:dark-souls', visibility: 'private' });
    await GOS.storage.put('evidence', record);
    const exportedPayload = await GOS.storage.exportAll();
    const saved = exportedPayload.collections.evidence.find((item) => item.id === record.id);
    return {
      visibility: saved.visibility,
      autoPublish: saved.autoPublish,
      publicRecord: GOS.media.publicRecord(saved),
      hasBytes: Object.prototype.hasOwnProperty.call(saved, 'bytes') || Object.prototype.hasOwnProperty.call(saved, 'data')
    };
  });
  check(privacy.visibility === 'private' && privacy.autoPublish === false,
    'media attachment privacy persists explicitly');
  check(privacy.publicRecord === null && privacy.hasBytes === false,
    'private media is not made public and exported metadata contains no bytes');

  await page.setViewportSize({ width: 390, height: 844 });
  const beforeMobileBlank = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.click('.nav-btn[data-tab="test"]');
  const mobileBlank = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    gameName: document.getElementById('gameName').value,
    platform: document.getElementById('platform').value,
    unanswered: document.querySelectorAll('.metric-row.is-unanswered').length,
    disabled: document.getElementById('calculateBtn').disabled,
    experiences: GOS.gos.context().experiences.length
  }));
  check(mobileBlank.scroll <= mobileBlank.viewport + 1 && mobileBlank.gameName === '' && mobileBlank.platform === '' && mobileBlank.unanswered === 9 && mobileBlank.disabled,
    'mobile opens directly into a blank, usable new-test form without overflow', JSON.stringify(mobileBlank));
  check(mobileBlank.experiences === beforeMobileBlank,
    'opening a blank mobile test preserves history and Taste Atlas evidence');
  await page.click('.nav-btn[data-tab="results"]');
  await page.waitForTimeout(150);
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    glyphWidth: Math.round(document.querySelector('#resultGlyph .experience-radar__art')?.getBoundingClientRect().width || 0),
    hostWidth: Math.round(document.querySelector('#resultGlyph')?.getBoundingClientRect().width || 0),
    labels: Array.from(document.querySelectorAll('#resultGlyph .experience-radar__label')).map((label) => {
      const box = label.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    }),
    spacing: (() => {
      const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const svg = document.querySelector('#resultGlyph .experience-radar__art');
      const matrix = svg.getScreenCTM();
      const center = new DOMPoint(100, 100).matrixTransform(matrix);
      const radius = 84 * Math.abs(matrix.a);
      const labels = Array.from(document.querySelectorAll('#resultGlyph .experience-radar__label')).map((node) => node.getBoundingClientRect());
      const clearsGlyph = (box) => {
        const closestX = Math.max(box.left, Math.min(center.x, box.right));
        const closestY = Math.max(box.top, Math.min(center.y, box.bottom));
        return Math.hypot(closestX - center.x, closestY - center.y) >= radius;
      };
      let pairwise = 0;
      labels.forEach((box, index) => labels.slice(index + 1).forEach((other) => { if (overlap(box, other)) pairwise++; }));
      return { pairwise, glyph: labels.filter((box) => !clearsGlyph(box)).length };
    })()
  }));
  check(mobile.scroll <= mobile.viewport + 1, 'responsive UI has no horizontal page overflow', JSON.stringify(mobile));
  check(mobile.glyphWidth >= mobile.hostWidth * .9 && mobile.glyphWidth <= mobile.viewport,
    'mobile keeps the radar visually dominant without viewport clipping', JSON.stringify(mobile));
  check(mobile.labels.length === 9 && mobile.labels.every((box) => box.left >= -1 && box.right <= mobile.viewport + 1),
    'all nine mobile perimeter labels remain inside the viewport', JSON.stringify(mobile.labels));
  check(mobile.spacing.pairwise === 0 && mobile.spacing.glyph === 0,
    'mobile perimeter labels overlap neither one another nor the radar', JSON.stringify(mobile.spacing));
  await page.locator('#resultGlyph .experience-radar__sector[data-glyph-dimension="flow"]').click();
  check(await page.locator('.results-dimensions [data-glyph-dimension="flow"].is-dimension-active').count() === 1,
    'mobile tap on a radar point pins the matching dimension');
  await page.locator('#resultGlyph .experience-radar__sector[data-glyph-dimension="flow"]').click();
  await page.setViewportSize({ width: 1500, height: 1000 });

  /* ================ M. TEST-SCREEN AUTOCOMPLETE ================ */
  console.log('\n--- M. TEST-SCREEN AUTOCOMPLETE ---');
  await page.click('.nav-btn[data-tab="test"]');
  await page.waitForSelector('#gameName', { state: 'visible' });

  await page.click('#gameName');
  await page.type('#gameName', 'Gears', { delay: 25 });
  await page.waitForSelector('#gameNameResults:not([hidden]) .gos-ac-row', { timeout: 5000 });
  const gearsAc = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#gameNameResults .gos-ac-row')).map((row) => ({
      name: row.querySelector('.gos-search-name')?.textContent.trim() || '',
      meta: row.querySelector('.gos-search-meta')?.textContent.trim() || '',
      cover: row.querySelector('.gos-ac-cover')?.getAttribute('src') || ''
    })),
    dividers: Array.from(document.querySelectorAll('#gameNameResults .gos-search-divider')).map((d) => d.textContent.trim()),
    expanded: document.getElementById('gameName').getAttribute('aria-expanded'),
    open: !document.getElementById('gameNameResults').hidden
  }));
  check(gearsAc.rows.length >= 3 && gearsAc.rows.some((r) => r.name === 'Gears of War' || r.name === 'Gears 5'),
    'typing "Gears" shows matching games instantly',
    JSON.stringify(gearsAc.rows.map((r) => r.name)));
  check(gearsAc.rows.length > 0 && gearsAc.rows.every((r) => /^data:image\/svg\+xml/.test(r.cover))
    && gearsAc.rows.some((r) => /2006/.test(r.meta) && /PC/.test(r.meta)),
    'suggestion rows show cover art, release year and platforms', JSON.stringify(gearsAc.rows));
  check(gearsAc.expanded === 'true' && gearsAc.open && gearsAc.dividers.length >= 1,
    'the dropdown announces itself open and groups its matches', JSON.stringify(gearsAc));

  await page.keyboard.press('ArrowDown');
  const activeFirst = await page.evaluate(() => document.getElementById('gameName').getAttribute('aria-activedescendant'));
  await page.keyboard.press('ArrowDown');
  const activeSecond = await page.evaluate(() => document.getElementById('gameName').getAttribute('aria-activedescendant'));
  check(!!activeFirst && !!activeSecond && activeFirst !== activeSecond,
    'arrow keys move the active suggestion', activeFirst + ' -> ' + activeSecond);
  await page.keyboard.press('Enter');
  const keyboardPick = await page.evaluate(() => ({
    value: document.getElementById('gameName').value,
    gameId: document.getElementById('gameNameWrap').dataset.gameId || null,
    open: !document.getElementById('gameNameResults').hidden
  }));
  check(/^Gears/.test(keyboardPick.value) && !!keyboardPick.gameId && !keyboardPick.open,
    'Enter selects the highlighted game, keeps its canonical id, and closes',
    JSON.stringify(keyboardPick));

  await page.fill('#gameName', '');
  await page.type('#gameName', 'dark souls', { delay: 20 });
  await page.waitForSelector('#gameNameResults:not([hidden]) .gos-ac-row');
  const libraryFirst = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#gameNameResults .gos-ac-row'));
    return {
      first: rows[0]?.querySelector('.gos-search-name')?.textContent.trim() || '',
      badge: rows[0]?.querySelector('.gos-ac-badge')?.textContent.trim() || '',
      order: rows.map((r) => r.querySelector('.gos-search-name')?.textContent.trim())
    };
  });
  check(libraryFirst.first === 'Dark Souls' && /In library/.test(libraryFirst.badge),
    'library games rank first and show a library badge', JSON.stringify(libraryFirst));

  await page.keyboard.press('Escape');
  const escapedAc = await page.evaluate(() => ({
    open: !document.getElementById('gameNameResults').hidden,
    value: document.getElementById('gameName').value
  }));
  check(!escapedAc.open && escapedAc.value === 'dark souls',
    'Escape closes the dropdown but keeps the typed name', JSON.stringify(escapedAc));
  await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => !document.getElementById('gameNameResults').hidden),
    'ArrowDown reopens suggestions for the same query');

  await page.locator('#gameNameResults .gos-ac-row').first().click();
  const pointerPick = await page.evaluate(() => ({
    value: document.getElementById('gameName').value,
    gameId: document.getElementById('gameNameWrap').dataset.gameId || null,
    suggestHidden: document.getElementById('gamePlatformSuggest').hidden,
    chips: Array.from(document.querySelectorAll('#gamePlatformSuggest .gos-ac-chip')).map((c) => c.textContent.trim())
  }));
  check(pointerPick.value === 'Dark Souls' && pointerPick.gameId === 'game:dark-souls',
    'selecting a result fills the title and retains its canonical game id',
    JSON.stringify(pointerPick));
  check(pointerPick.suggestHidden === false && pointerPick.chips.includes('PC'),
    'known platforms are offered as optional chips, not forced', JSON.stringify(pointerPick.chips));

  await page.click('#gamePlatformSuggest .gos-ac-chip >> text=PC');
  check(await page.inputValue('#platform') === 'PC', 'tapping a platform chip sets the platform select');
  const chipState = await page.evaluate(() =>
    document.querySelector('#gamePlatformSuggest .gos-ac-chip.is-picked')?.textContent.trim() || '');
  check(chipState === 'PC', 'the picked platform chip is marked', chipState);

  await page.fill('#gameName', '');
  await page.type('#gameName', 'qqqjunkxyzzyqq', { delay: 15 });
  await page.waitForSelector('#gameNameResults .gos-ac-custom', { timeout: 5000 });
  const customAc = await page.evaluate(() => ({
    empty: !!document.querySelector('#gameNameResults .gos-search-empty'),
    label: document.querySelector('#gameNameResults .gos-ac-custom .gos-search-name')?.textContent.trim() || ''
  }));
  check(customAc.empty && /custom name/.test(customAc.label),
    'unknown names get an explicit custom-name entry', JSON.stringify(customAc));
  await page.keyboard.press('Enter');
  const customPick = await page.evaluate(() => ({
    value: document.getElementById('gameName').value,
    gameId: document.getElementById('gameNameWrap').dataset.gameId || null,
    open: !document.getElementById('gameNameResults').hidden
  }));
  check(customPick.value === 'qqqjunkxyzzyqq' && !customPick.gameId && !customPick.open,
    'choosing the custom entry keeps the typed name and no catalog id', JSON.stringify(customPick));

  await page.fill('#gameName', '');
  await page.type('#gameName', 'Gears of War', { delay: 15 });
  await page.waitForSelector('#gameNameResults:not([hidden]) .gos-ac-row');
  await page.locator('#gameNameResults .gos-ac-row').first().click();
  const gearsPick = await page.evaluate(() => ({
    value: document.getElementById('gameName').value,
    gameId: document.getElementById('gameNameWrap').dataset.gameId || null
  }));
  check(gearsPick.value === 'Gears of War' && gearsPick.gameId === 'game:gears-of-war',
    'exact catalog match keeps the seed id', JSON.stringify(gearsPick));

  await page.selectOption('#platform', 'PC');
  await setScores(page, { control: 8, clarity: 8, freedom: 7, expression: 7, engagement: 9, depth: 8, flow: 8, intensity: 9, replay: 7 });
  const experiencesBeforeAc = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.click('#calculateBtn');
  await page.waitForFunction((n) => GOS.gos.context().experiences.length > n, experiencesBeforeAc,
    { timeout: 15000 });
  await page.waitForFunction(() => {
    const active = document.querySelector('.tab.active');
    const btn = document.getElementById('calculateBtn');
    return !!(active && active.id === 'dashboard' && btn && !btn.disabled);
  }, null, { timeout: 10000 });
  const savedAc = await page.evaluate(() => {
    const ctx = GOS.gos.context();
    const latest = ctx.experiences.slice().sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    return {
      gameId: latest.gameId,
      name: latest.gameName,
      dupes: ctx.games.filter((g) => g.id === latest.gameId).length
    };
  });
  check(savedAc.gameId === 'game:gears-of-war',
    'the saved experience keeps the canonical autocomplete id', JSON.stringify(savedAc));
  check(savedAc.dupes === 1, 'no duplicate game records are created', JSON.stringify(savedAc));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('.nav-btn[data-tab="test"]');
  await page.waitForSelector('#gameName', { state: 'visible' });
  await page.click('#gameName');
  await page.type('#gameName', 'Halo', { delay: 20 });
  await page.waitForSelector('#gameNameResults:not([hidden]) .gos-ac-row');
  const mobileAc = await page.evaluate(() => {
    const panel = document.getElementById('gameNameResults').getBoundingClientRect();
    return {
      top: Math.round(panel.top),
      bottom: Math.round(panel.bottom),
      left: Math.round(panel.left),
      right: Math.round(panel.right),
      vh: window.innerHeight,
      vw: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      rows: document.querySelectorAll('#gameNameResults .gos-ac-row').length
    };
  });
  check(mobileAc.rows >= 1, 'mobile typing shows local matches', JSON.stringify(mobileAc));
  check(mobileAc.top >= -1 && mobileAc.bottom <= mobileAc.vh + 1
    && mobileAc.left >= -1 && mobileAc.right <= mobileAc.vw + 1,
    'mobile dropdown stays inside the viewport', JSON.stringify(mobileAc));
  check(mobileAc.scroll <= mobileAc.client + 1, 'mobile autocomplete adds no horizontal overflow',
    JSON.stringify(mobileAc));

  await page.evaluate(() => {
    const row = document.querySelector('#gameNameResults .gos-ac-row');
    row.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true
    }));
  });
  const touchPick = await page.evaluate(() => ({
    value: document.getElementById('gameName').value,
    gameId: document.getElementById('gameNameWrap').dataset.gameId || null,
    open: !document.getElementById('gameNameResults').hidden
  }));
  check(/^Halo/.test(touchPick.value) && !!touchPick.gameId && !touchPick.open,
    'touch-style tap selects a suggestion on mobile', JSON.stringify(touchPick));
  await page.setViewportSize({ width: 1500, height: 1000 });

  /* ======================= GLOBAL SANITY ======================= */
  console.log('\n--- GLOBAL SANITY ---');
  check(consoleErrors.length === 0, 'no console/page errors',
    JSON.stringify(consoleErrors.slice(0, 4)));
  check(badResponses.length === 0, 'no broken asset requests',
    JSON.stringify(badResponses.slice(0, 4)));

  await browser.close();
  server.close();

  console.log('\n' + '='.repeat(56));
  console.log(`E2E RESULT: ${passed} passed, ${problems.length} failed`);
  if (problems.length) {
    console.log('FAILURES:');
    problems.forEach((p) => console.log(' - ' + p));
    process.exit(1);
  }
  console.log('ALL FLOWS A-M PASSED');
})().catch((error) => {
  console.error('E2E CRASH:', error);
  process.exit(1);
});
