# Product Insights — GitHub-driven localhost updates (prototype)

**Owner's operating model:** laptop executes; GitHub is source of code and approved releases; AI processing/provider is a separate workflow. The updater has **no** dependence on ChatGPT, Ollama, Cloudflare or an AI API key.

## What works in this PR

- Validates an exact stable-channel JSON schema at `local/unified-lab/channels/stable.json` on the reviewed `main` branch.
- Each approved source file is fetched from an **immutable 40-character Git commit** in `KaranBarua01/Product-Insights`.
- Enforces an exact file allowlist, expected original SHA-256, downloaded SHA-256, maximum file/count/total bytes, and refusal of symlink paths. No update can target `data/`, `results/`, `local-data/`, `runtime/`, `node_modules/` or credentials.
- Background watcher (15-minute interval) discovers and **stages only**; code continues running unchanged.
- On next localhost startup the updater checks for staged changes, confirms port 8791 is offline, applies source files with a backup and journal, runs the existing local regression suite, and restores the previous files if it fails.
- Failed or manually rolled-back releases are **quarantined**: they are not automatically reapplied on the next start.
- Fixed GitHub agent commands `update_status`, `update_check`, `update_stage`. No arbitrary remote shell or remote in-process code replacement.
- Pure Node.js 24 and Windows PowerShell 5.1; no npm install required by the updater. Existing local database and benchmark results are preserved.

## Important boundary

**This PR is not deployed and does not yet make the entire v0.4-based localhost application canonical in GitHub.** The version installed on the owner's laptop originated in a local full-application ZIP. The existing private queue can run research and tests but **cannot install the updater without a one-time local bootstrap**. The first approved release is a harmless text canary (`updater/release-marker.txt`) to verify staging, installation and rollback without changing app logic. Do not imply that a draft PR has already upgraded the laptop.

The one-time installer is `tools/pi-local-updater/enable-github-updates.ps1`. It requires the **known** Phase 4 v0.4-based root with the recently repaired `app/queue-agent.mjs`; it refuses unknown local source versions, a running localhost, and missing application files. It downloads six files from one pinned public GitHub commit, verifies Git blob hashes, runs updater tests and local tests, and adds `START_GITHUB_AGENT.bat` and `START_GITHUB_LOCALHOST.bat`. Future source updates use those launchers; no more ZIP upgrades.

Do not use this installer on the older v0.8 root or a different PI agent. Preserve that installation.

## Testing

```
node --test tools/pi-local-updater/*.test.mjs
node tools/pi-local-updater/canary-e2e.mjs
```

Windows + Ubuntu Node 24 GitHub CI runs the offline safety suite and real pinned canary transfer. Windows CI also runs the one-time PowerShell installer in `-TestOnly` mode without modifying a local lab. **The real Windows laptop installation and localhost restart still require operator execution and a confirmed agent result.**

## Publication / release process

1. Develop source changes in a GitHub feature branch and pass CI.
2. Publish the source-only file(s) under `local/unified-lab/<relative_path>` in a reviewed commit; **never** publish the local SQLite database, tokens, source evidence packets or user files.
3. Construct a new stable-channel manifest pointing at that existing immutable commit. Include one entry per change with `path`, `bytes`, `sha256`, `fromSha256` (null for a new file); never repeat a `releaseId`.
4. Review the manifest and immutable source together, enable branch-protection/approval on `main`, and promote it explicitly. No arbitrary PR push causes a local update. SHA-256 proves bytes match the manifest, **not** that the manifest's publisher is trustworthy.
5. The laptop stages the release automatically. On next authorized, offline startup it applies the release and runs smoke tests. A failure restores files and quarantines that release; review before replacing the release.
6. Use `node updater/cli.mjs status .` to inspect and `node updater/cli.mjs rollback .` (after stopping the lab) to roll back a successful source-only update.

### Remaining integration

- Import the **current** full local application source and repaired queue agent into the canonical GitHub tree without private data, reconcile differences from v0.8, and publish a reviewed non-canary release.
- Present update status/history and restart controls in the localhost UI.
- Confirm one-time Windows bootstrap, remote `update_status` and `update_stage` actions through the private queue.
- Extend the update protocol for Node dependency migrations and SQLite schema migrations separately with explicit backups. **Neither is supported by this source-only v1.**

**AI evidence processing and taxonomy write-back are intentionally unchanged.**
