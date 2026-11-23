'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { resolveChromium } = require('../tests/playwright-resolve');
const chromium = resolveChromium();

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'radar-comparison');
const PORT = 8991;
const profiles = [
  { slug: 'balanced-near-perfect', name: 'Balanced Apex', scores: { control: 10, clarity: 10, freedom: 10, expression: 10, engagement: 10, depth: 10, flow: 10, intensity: 10, replay: 10 } },
  { slug: 'movement-control', name: 'Kinetic Edge', scores: { control: 10, clarity: 8, freedom: 9, expression: 8, engagement: 8, depth: 2, flow: 10, intensity: 9, replay: 7 } },
  { slug: 'depth-exploration', name: 'Deep Cartographer', scores: { control: 5, clarity: 7, freedom: 9, expression: 8, engagement: 8, depth: 10, flow: 6, intensity: 2, replay: 7 } },
  { slug: 'mixed-asymmetric', name: 'Fractured Vanguard', scores: { control: 10, clarity: 3, freedom: 8, expression: 2, engagement: 9, depth: 5, flow: 10, intensity: 4, replay: 7 } }
];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

function server() {
  return http.createServer((req, res) => {
    let target = path.normalize(path.join(ROOT, decodeURIComponent(req.url.split('?')[0] || '/')));
    if (target.endsWith(path.sep)) target += 'index.html';
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
}

async function setResult(page, profile) {
  await page.click('.nav-btn[data-tab="test"]');
  await page.fill('#gameName', profile.name);
  await page.evaluate((values) => Object.keys(values).forEach((key) => {
    const input = document.getElementById(key);
    input.value = String(values[key]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }), profile.scores);
  await page.evaluate(() => {
    updateResults(getState(), true);
    showTab('results');
  });
  await page.waitForSelector('#resultGlyph svg');
  await page.waitForTimeout(80);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const web = server();
  await new Promise((resolve) => web.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.GOS && GOS.gos && GOS.gos.context().booted);
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });

  for (const profile of profiles) {
    await setResult(page, profile);
    await page.locator('#results').screenshot({ path: path.join(OUT, profile.slug + '.png') });
  }
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.GOS && GOS.glyph && GOS.gos && GOS.gos.context().booted);
  await page.evaluate((scores) => {
    document.body.innerHTML = '<main id="variantGate" style="min-height:100vh;background:#050608;color:#fff;padding:42px;font-family:Inter,system-ui"><h1 style="text-transform:uppercase;letter-spacing:.08em">One renderer, identical fixed scales</h1><div id="variantGrid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px"></div></main>';
    var grid = document.getElementById('variantGrid');
    [
      { variant: 'session', label: 'Session radar', data: { type: 'session', scores: scores, score: 7.1, sampleCount: 1 } },
      { variant: 'game', label: 'Game aggregate', data: { type: 'game', scores: scores, score: 7.1, sampleCount: 6 } },
      { variant: 'taste', label: 'Taste radar', data: { type: 'taste', scores: scores, score: 7.1, sampleCount: 18, distinctGames: 9 } }
    ].forEach(function (item) {
      var card = document.createElement('article');
      card.style.cssText = 'display:grid;justify-items:center;background:#0a0c10;border:1px solid #252a33;border-radius:18px;padding:22px';
      var title = document.createElement('h2'); title.textContent = item.label; title.style.cssText = 'font-size:17px;text-transform:uppercase;letter-spacing:.1em';
      card.appendChild(title);
      card.appendChild(GOS.glyph.render(item.data, { size: 'xl', variant: item.variant, label: item.label }));
      grid.appendChild(card);
    });
  }, profiles[3].scores);
  await page.setViewportSize({ width: 1500, height: 720 });
  await page.screenshot({ path: path.join(OUT, 'variant-family.png'), fullPage: true });

  await page.setContent(`<!doctype html><html><head><style>body{margin:0;background:#050608;color:#fff;font-family:Arial;padding:32px}h1{letter-spacing:.08em;text-transform:uppercase}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.card{background:#0a0c10;border:1px solid #252a33;border-radius:16px;padding:14px}.card h2{font-size:16px;margin:0 0 12px}.card img{display:block;width:100%;border-radius:10px}</style></head><body><h1>Experience Radar Profile Gate</h1><main>${profiles.map((p) => `<article class="card"><h2>${p.name}</h2><img src="http://127.0.0.1:${PORT}/artifacts/radar-comparison/${p.slug}.png"></article>`).join('')}</main></body></html>`);
  await page.setViewportSize({ width: 1600, height: 1800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'comparison-sheet.png'), fullPage: true });
  await browser.close(); web.close();
  console.log(OUT);
})().catch((error) => { console.error(error); process.exitCode = 1; });