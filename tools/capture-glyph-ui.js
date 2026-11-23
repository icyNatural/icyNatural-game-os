'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveChromium } = require('../tests/playwright-resolve');
const chromium = resolveChromium();

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'screenshots');
const PORT = 8988;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function server() {
  return http.createServer((req, res) => {
    let target = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0] || '/')));
    if (target.endsWith(path.sep)) target += 'index.html';
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      res.statusCode = 404; res.end('not found'); return;
    }
    res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
}

async function score(page, gameName, values) {
  await page.click('.nav-btn[data-tab="test"]');
  await page.waitForSelector('#gameName', { state: 'visible' });
  await page.fill('#gameName', gameName);
  await page.selectOption('#platform', 'PC');
  await page.evaluate((scores) => Object.keys(scores).forEach((key) => {
    const input = document.getElementById(key);
    input.value = scores[key];
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }), values);
  const before = await page.evaluate(() => GOS.gos.context().experiences.length);
  await page.click('#calculateBtn');
  await page.waitForFunction((count) => GOS.gos.context().experiences.length > count, before, { timeout: 15000 });
  await page.waitForFunction(() => {
    const active = document.querySelector('.tab.active');
    const btn = document.getElementById('calculateBtn');
    return !!(active && active.id === 'dashboard' && btn && !btn.disabled);
  }, null, { timeout: 10000 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const web = server();
  await new Promise((resolve) => web.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.GOS && GOS.gos && GOS.gos.context().booted);

  await score(page, 'Dark Souls', { control: 9, clarity: 6, freedom: 8, expression: 9, engagement: 10, depth: 9, flow: 9, intensity: 8, replay: 9 });
  await score(page, 'Dark Souls', { control: 8, clarity: 4, freedom: 8, expression: 9, engagement: 9, depth: 9, flow: 8, intensity: 8, replay: 9 });
  await score(page, 'Halo Infinite', { control: 8, clarity: 8, freedom: 7, expression: 7, engagement: 8, depth: 6, flow: 8, intensity: 8, replay: 7 });

  await page.screenshot({ path: path.join(OUT, 'after-dashboard-radar.png'), fullPage: true });
  await page.click('.nav-btn[data-tab="results"]');
  await page.waitForSelector('#resultGlyph .experience-radar__art');
  await page.screenshot({ path: path.join(OUT, 'after-results-radar.png'), fullPage: true });
  await page.locator('#resultGlyph .experience-radar__label[data-glyph-dimension="depth"]').hover();
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(OUT, 'after-results-radar-hover.png'), fullPage: true });
  await page.click('.nav-btn[data-tab="discover"]');
  await page.waitForSelector('#discoverSearch', { state: 'visible' });
  await page.evaluate(() => GOS.discover.open('game:dark-souls'));
  await page.waitForSelector('.game-dossier');
  await page.screenshot({ path: path.join(OUT, 'after-game-detail-radar.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('.nav-btn[data-tab="results"]');
  await page.screenshot({ path: path.join(OUT, 'after-results-mobile-radar.png'), fullPage: true });
  await page.click('.nav-btn[data-tab="dashboard"]');
  await page.screenshot({ path: path.join(OUT, 'after-dashboard-mobile-radar.png'), fullPage: true });
  await page.click('.nav-btn[data-tab="atlas"]');
  await page.waitForSelector('#tasteGlyph .experience-radar__art');
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, 'after-taste-radar.png'), fullPage: true });

  await browser.close();
  web.close();
  console.log(OUT);
})().catch((error) => { console.error(error); process.exit(1); });