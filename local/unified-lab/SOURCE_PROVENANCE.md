# Phase 4 unified localhost application — source baseline

This directory contains the canonical, **source-only** version of the Phase 4 local research application used for Product Insights. It is separate from the updater implementation at `tools/pi-local-updater/`.

## Provenance
- Original source: `Product_Insights_Unified_Phase4_Full_Application.zip` (the existing v0.4-based Phase 4 research lab package).
- Queue extension: reconstructed from the exact two source files in the previously installed, hash-checked `ENABLE_REMOTE_TESTING.bat` payload.
- GitHub update bridge: applied the existing `tools/pi-local-updater/bridge-patch.mjs` transformations to the known original queue agent and `start.mjs`.
- Source baseline import: commit `129dc617306366816574cc0d8a75cd26d059735e` (28 text/code files, no SQLite DB).
- Subsequent UI update: adds read-only release information to the existing localhost `/api/status` payload and a corresponding status indicator in the header. It **does not** alter the AI processing, taxonomy write-back, or research acquisition policies.

This snapshot is reconstructed from packaged source and approved patches, not a byte-for-byte export of the currently running PC. On-device source mismatches MUST fail closed via `fromSha256` before any update is staged or installed.

## Local files deliberately excluded
- `data/knowledge.sqlite` (about 50 MB), `data/manifest.json` (derived packaged DB metadata), results, credentials, tokens, transient `local-data/`, `node_modules/`, installed runtime, and private website evidence.
- The user keeps all runtime databases/results on their laptop; they are **not** uploaded to this public source repository.
- The separate older v0.8 application remains unchanged and is not represented as imported here.

## Release boundaries
1. Work in PR branches. Ensure GitHub CI passes, then review and merge.
2. Source-only release manifests live at `channels/stable.json` and point to an **immutable commit already merged** to `main`.
3. For each changed source path, publish a new `sha256`, exact expected `fromSha256` (or null for new files), and length. No generic shell commands or packages.
4. The laptop checks the public channel, verifies hashes and existing sources, then stages only. Offline start activates and runs local regression tests. Failure restores source files and quarantines the release.
5. Only source extensions `.mjs`, `.js`, `.html`, `.css`, text and launcher scripts are supported. Database migrations, dependency upgrades and arbitrary file deletions are **not** supported.

## Validation
The GitHub `PI local lab source QA` workflow runs Node.js syntax, pure update-status module fixtures and source boundary checks on Windows and Ubuntu. The full research/acquisition integration tests require the laptop's original database and pinned Scrappers runtime; passing source QA alone is not live research accuracy.

## AI neutrality
The update mechanism and new read-only dashboard status have **no dependency** on ChatGPT, Ollama, another AI provider or Cloudflare deployment. Existing evidence-to-intelligence processing remains unchanged.
