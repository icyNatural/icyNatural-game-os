'use strict';
// Uses an isolated temporary browser context. Never connects to a real Chrome profile.
const assert = require('node:assert/strict');
const { resolveChromium } = require('./playwright-resolve');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const browser = await resolveChromium().launch({ headless: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'gos-recovery-test-'));
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    console.log('Opening isolated recovery test');
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 6000 });
    await page.waitForFunction(() => window.GOS?.gos?.context().booted);
    const source = await page.evaluate(async () => {
      const p = await GOS.storage.exportAll();
      p.collections.experiences.push({
        id: 'exp:synthetic-recovery-test', gameId: 'game:synthetic-test',
        gameName: 'SYNTHETIC RECOVERY TEST', score: 11,
        scores: Object.fromEntries(['control','clarity','freedom','expression','engagement','depth','flow','intensity','replay'].map(k => [k, 7])),
        platform: 'PC', notes: 'Synthetic test only, not personal data.',
        created_at: '2026-10-01T00:00:00.000Z', context: { mode: 'overall' }, friction: []
      });
      return p;
    });
    const input = path.join(temp, 'synthetic.json');
    fs.writeFileSync(input, JSON.stringify(source));
    const report = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, '../tools/verify-backup.mjs'), input, temp], { encoding: 'utf8' }));
    assert.ok(report.sha256);
    assert.equal(report.counts.experiences, 1);
    const result = await page.evaluate(async p => {
      const r = await GOS.storage.importAll(p);
      await GOS.gos.refresh();
      document.dispatchEvent(new CustomEvent('gos:data'));
      return r;
    }, source);
    assert.equal(result.verified, true);
    console.log('Atomic IndexedDB import verified');
    await page.click('.nav-btn[data-tab="history"]');
    const row = page.locator('#historyGamesList [data-history-key="exp:synthetic-recovery-test"]');
    assert.match(await row.innerText(), /11\.0/);
    await row.click();
    await page.waitForFunction(() => document.querySelector('#resultScore').textContent === '11.0', null, { timeout: 6000 });
    assert.ok(await page.locator('#resultGlyph svg').count());
    const conflict = structuredClone(source);
    conflict.collections.experiences[0].score = 10;
    assert.equal((await page.evaluate(p => GOS.storage.importAll(p), conflict)).ok, false);
    const duplicate = await page.evaluate(p => GOS.storage.importAll(p), source);
    assert.equal(duplicate.added.experiences, 0);
    await page.reload();
    await page.waitForFunction(() => window.GOS?.gos?.context().booted);
    assert.equal(await page.evaluate(() => GOS.gos.context().experiences[0].score), 11);
    console.log('PASS: isolated IndexedDB recovery, verified archive, deduplication, conflict rejection, History, saved 11.0 Results, radar and reload');
  } finally {
    await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });