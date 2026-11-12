# Active development — single-task ownership register

**Source of truth:** GitHub Issues; use issue numbers for decisions, owners and PR links. Do not maintain a second independent task board for the same work.

| Issue | Workstream | Primary DRI | State / dependency |
|---|---|---|---|
| [#1 Collaboration and protections](https://github.com/KaranBarua01/Product-Insights/issues/1) | PLATFORM | Karan | Documentation + CI initial setup; manual branch ruleset and Patricio invite still needed |
| [#2 Reviewed website facts export](https://github.com/KaranBarua01/Product-Insights/issues/2) | ACQUISITION | Karan | Independent work; align with #4 before freezing output |
| [#3 Import Python manufacturing engines](https://github.com/KaranBarua01/Product-Insights/issues/3) | MANUFACTURING | Patricio | Independent work; no raw private handoff data in public repo |
| [#4 Versioned facts → engineering contract](https://github.com/KaranBarua01/Product-Insights/issues/4) | INTEGRATION | Both (joint review) | Joint decision required before either engine relies on the schema |
| [#5 Synthetic-only end-to-end pilot](https://github.com/KaranBarua01/Product-Insights/issues/5) | INTEGRATION | Joint DRI to agree | Blocked by reviewed outputs from #2, #3, #4 |

## How to claim work

Before opening a branch, comment on the issue with: **"I own <specific deliverable>; branch <name>; files <paths>; dependencies <issue links>"**. If work overlaps, resolve it on the issue before coding. Update the PR with the issue number and canonical folder; mark the task complete only when tests, other-owner review and the issue's acceptance criteria are satisfied.

## No-duplication checklist

Does the capability exist in `Scrappers/`, `engine/pattern-systems/`, `intelligence/manufacturing/`, `contracts/` or the [registry](../../collaboration/workstreams.json)? Has another issue or branch already claimed it? If so, extend or collaborate rather than implementing an alternative.
