# Existing Game OS website

The existing GitHub Pages URL remains unchanged. The workflow builds an explicit
public-only artifact from index.html and its reviewed runtime assets. Repository
backups, test fixtures, tools, local exports and private data are not served.

All core features are browser-local. Existing origin storage is preserved; no
remote storage migration or data clearing is part of deployment. Export backups
before importing data. Import tests use disposable browser contexts, never user
profiles. Existing saved evaluations are retained by the migration code.

The included static seed catalog works offline. Optional live RAWG search needs
an explicitly configured compatible endpoint or a user-provided session key;
no service credential or local proxy is deployed by this static website.

Run `npm test` for public core tests. One schema integration test requires the
separately maintained private branch-schema repository; set BRANCH_SCHEMA_ROOT
to its local root to run the complete suite. When unavailable, it is
explicitly skipped, not reported as passed. No private validator is published.

Run `npm run build` to construct dist. The generated release-manifest.json lists
every runtime asset with its SHA256. Tests and local server tooling remain out
of the Pages artifact. Browser suites require an available Playwright installation.

Normal experience saves commit experiences, signals, media metadata and new game/
library entries as one transaction. A failed save stays on the form and retains
the draft for retry; it does not fall back to divergent legacy-only records.
Existing game/library records and historical recovered scores are preserved.
The localStorage fallback commits one blob or rejects without changing its cache.