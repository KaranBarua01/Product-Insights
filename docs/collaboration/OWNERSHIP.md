# Ownership map — avoid duplicate implementations

The source of truth for machine-readable capability locations is [workstreams.json](../../collaboration/workstreams.json). Issue ownership and status are tracked via [ACTIVE_WORK.md](ACTIVE_WORK.md).

## Workstreams and file boundaries

| Workstream | Primary DRI | Write scope | Existing upstream/downstream |
|---|---|---|---|
| ACQUISITION | Karan | `engine/pattern-systems/**`, `Scrappers/**` | URL → patterns → router → extracted evidence → JS proposals |
| MANUFACTURING | Patricio | `intelligence/manufacturing/**` | Reviewed facts → process requirements → synthetic supplier matching |
| INTEGRATION | Joint, one DRI per issue | `contracts/**`, `integration/**` | Shared schema, fixtures, adapters and cross-engine tests |
| PLATFORM | Karan, both consulted as needed | `.github/**`, `scripts/collaboration/**`, `docs/collaboration/**`, `collaboration/**`, root docs | PR process and central release coordination |

**Snapshot exception:** `Scrappers/src/patricio-pilot.ts` contains **precomputed demo data**, not an executable manufacturing engine. Karan owns the UI display of it; Patricio owns the eventual Python source code. Do not add a second TypeScript inference engine beside the snapshot.

## Rules

1. **One capability → one canonical implementation path.** Extend an existing module instead of introducing a parallel service in another person's folder.
2. **One task → one GitHub issue → one primary DRI → one branch.** Multiple contributors may co-develop, but only the issue's DRI coordinates competing changes.
3. **Changes across lanes** require a joint INTEGRATION issue, explicit cross-lane checkbox in the PR, agreement on schema impact and other-owner review.
4. **Interface changes are versioned and additive** until both consumers are migrated. Never rename required JSON fields behind the other person's back.
5. **Production deploys belong exclusively to Development Controller.** No independent Wrangler deploy workflows in this repo. Only Karan coordinates Worker revision pins.
6. **No data-quality shortcuts:** sourced quote ≠ reviewed truth; JS5 ≠ JS6; possible JS7 demand ≠ proven RFQ; synthetic matching ≠ qualified suppliers.
7. **New features begin with discovery:** search the implementation registry and issues; explain why existing code cannot be reused before proposing a new package.

## Changes that require both reviews

- `contracts/**`, `integration/**`, `Scrappers/src/types.ts`, JS semantics, taxonomy identifiers, source-evidence shape, company/component identity mapping.
- Any PR touching both acquisition and manufacturing implementations.
- Any change that changes when data crosses from unreviewed AI suggestions to engineering process inference.
- Any release impacting a shared Worker binding, endpoint, supplier data scope or production safety policy.

## GitHub limitations until settings are enabled

`CODEOWNERS` can request Karan's review of his and shared paths. Patricio's GitHub login has **not been supplied/verified**, so the manufacturing folder cannot yet carry a valid CODEOWNER entry. Add his confirmed username after granting repository access.

A CODEOWNERS file or a passing GitHub Action cannot by itself prevent pushing to an unprotected `main`. A repository maintainer must configure a branch ruleset and require CI + outside approval.
