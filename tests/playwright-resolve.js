'use strict';
/**
 * Portable Playwright resolution: project-local install first, then the
 * explicit PLAYWRIGHT_MODULE_PATH fallback. No machine-private paths are published.
 */
function resolveChromium() {
  const candidates = ['playwright', process.env.PLAYWRIGHT_MODULE_PATH].filter(Boolean);
  for (const id of candidates) {
    try {
      return require(id).chromium;
    } catch (e) { /* try next */ }
  }
  throw new Error(
    'Playwright not found. Install it (npm i -D playwright) or edit tests/playwright-resolve.js.'
  );
}

module.exports = { resolveChromium };
