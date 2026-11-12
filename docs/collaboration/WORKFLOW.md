# Parallel GitHub workflow and deployment safety

## Work in feature branches; PRs are the integration point

1. **Claim an issue** with primary owner, scope, paths, acceptance criteria and prior work references. See [ACTIVE_WORK.md](ACTIVE_WORK.md).
2. Pull `main` and create a branch: `feat/acquisition-<topic>`, `feat/manufacturing-<topic>`, `integration/<topic>` or `chore/platform-<topic>`.
3. Make changes **only** in the assigned lane. If you find a shared contract or another owner's file must change, record it on the issue and agree on scope first. Keep unrelated work out of the PR.
4. Run `npm test` in the affected Node folders and `pytest` in manufacturing after the Python package is added. Include sanitized fixtures and explain untested scenarios.
5. Open a PR using the template: identify `Workstream`, `Primary owner`, `Tracking issue`, source path, non-duplication check and evidence.
6. A shared/contract/deploy or multi-lane change must use the explicit **shared-change** checkbox and have both engineers review. CI checks metadata, file scope and all existing Node tests.
7. Merge only after tests, required external review and agreement on consumer contracts. If another PR moved main, update your branch and rerun tests; don't force-push main.
8. **Release separately:** Karan updates the reviewed source SHA in `development-controller` after merge, then verifies the existing Pattern Systems / Scrappers Workers and approved-site tests. Ordinary merges do **not** deploy.

## Rules to enable once in GitHub Settings (maintainer action)

Current state when this handoff was authored: **`main` was not protected** and no repository rulesets existed.

Open `https://github.com/KaranBarua01/Product-Insights/settings/rules` (or **Settings → Rules → Rulesets / Branches**). Configure a ruleset targeting `main`:

- Require a **pull request before merging**, with **at least one approval from someone other than the PR author**.
- Require the collaboration check, Pattern Systems tests, Scrappers tests and manufacturing-lane CI check once their exact status names appear in PR Checks.
- Require review from CODEOWNERS where supported; dismiss stale approvals after new pushes.
- Block force-pushes and branch deletion. Prefer restricting bypass to an emergency administrator procedure.
- After Patricio's account is confirmed, add him as a collaborator and update `/.github/CODEOWNERS` for `/intelligence/manufacturing/`. Do not invent his GitHub handle.

**Important:** Writing these instructions and CI files does **not** activate branch protection. If Settings disallows a ruleset, document the limitation in Issue #1 and use strict manual PR discipline until the repository/plan supports it.

## Who reviews what?

| PR area | Primary author | Required reviewer |
|---|---|---|
| Pattern / Scrapper / website AI | Karan | Patricio if interfaces or component semantics change; otherwise project peer |
| Manufacturing Python inference / supplier matching | Patricio | Karan (integration, safety, duplicate work) |
| Contract or adapter | One named DRI | **Both** Karan and Patricio before release |
| Deployment controller / Worker security | Karan | Technical peer, and Patricio if his data is affected |

## Two GitHub repos, one production release mechanism

- `Product-Insights`: **source of truth**, code + tests + collaboration rules; no automatic Cloudflare production deploy.
- `development-controller`: release orchestration. It **pins a specific Product-Insights commit** in its deployment workflow and registry, then deploys the existing named Workers. Do not edit controller pins casually; use a reviewed release PR and live smoke tests.
- Patricio can merge his Python work after review **without triggering a Cloudflare Worker deploy**. The engine is not connected to the deployed Worker yet.

## Conflict-resolution protocol

If two branches touch the same capability or schema, **stop development and decide ownership in the issue**. Keep one canonical implementation; move the second branch to tests, a fixture, adapter or review rather than duplicating core logic. If a schema changes, publish a versioned proposal, run consumers' contract tests and obtain both approvals.

Emergency fixes still require a tracking issue, tests and review. Do not disable security checks for speed.
