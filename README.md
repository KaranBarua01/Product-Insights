# Product Insights — shared development repository

> **Two people, one repository, distinct modules, one reviewed integration contract.**
> Start here: [Collaboration handoff](docs/collaboration/HANDOFF.md) · [Ownership](docs/collaboration/OWNERSHIP.md) · [Open work](docs/collaboration/ACTIVE_WORK.md) · [PR workflow](docs/collaboration/WORKFLOW.md).

This is the **public** source repository for the InsideJob Product Insights prototypes. Do **not** commit API tokens, InsideJob customer/supplier exports, proprietary blueprints, Patricio's original private research package, or unapproved internal data.

## What exists today

| Area | Canonical implementation | Reality |
|---|---|---|
| Website pattern detection | `engine/pattern-systems/` | Working Worker, 34 website patterns, 6 technology signals, 10 methods; sampled website evidence. |
| Scraper/router/evidence | `Scrappers/` | S01/S02/S03 implementations, Node/Playwright path and Cloudflare Worker. S01 live-tested on approved sites. |
| AI-assisted JS1–JS10 profile | `Scrappers/src/js-profile.ts` | Quote-backed **unverified proposals**, not a completed industrial intelligence database. |
| Patricio's manufacturing inference | `intelligence/manufacturing/process_inference/` | **Canonical future import path; executable Python prototype is not in this repo yet.** |
| Patricio's supplier process matching | `intelligence/manufacturing/supplier_matching/` | **Canonical future import path; synthetic-data matching stays separate.** |
| Management view of Patricio pilot | `Scrappers/src/patricio-pilot.ts` | Sanitized **static snapshot**; not a live call to his Python engines. |
| Evidence → engineering interface | `contracts/` | Proposal only; **not frozen and not connected to manufacturing inference.** |
| Production release | `KaranBarua01/development-controller` | Central controller pins reviewed commits and deploys existing Cloudflare Workers. |

Demo: https://product-insights-scrappers-prototype.injindiaops.workers.dev/demo

## Working in parallel

- **Karan — ACQUISITION:** Pattern Systems, scraper/router, Cloudflare adapter, JS1–JS10 website fact proposals, dashboard and benchmark.
- **Patricio — MANUFACTURING:** Python manufacturing-process inference, taxonomy mapping, rule validation and synthetic supplier matching, inside `intelligence/manufacturing/`.
- **Joint — INTEGRATION:** Reviewed component facts, versioned schemas, adapters and end-to-end pilot. Do not alter another lane's implementation without an integration issue and both reviews.
- **Karan — PLATFORM steward:** Shared CI, deployment pins, security settings and GitHub coordination; consult Patricio when changes affect his engine.

**Rule:** One capability has **one** canonical home in [the workstream registry](collaboration/workstreams.json). Before beginning work, find or create a GitHub issue and confirm the capability is not already implemented elsewhere.

## Local tests

Node.js 24+:

```bash
cd engine/pattern-systems && npm install --no-audit --no-fund && npm test
cd ../../Scrappers && npm install --omit=optional --no-audit --no-fund && npm test
```

Patricio's Python package should provide its own tests and dependencies when imported; see [the manufacturing lane handoff](intelligence/manufacturing/README.md). The shared CI intentionally does **not** claim his Python engine is installed already.

## Production safety

Merging to `main` runs **checks only**, not a Cloudflare deploy. To deploy approved code, update the pinned source revision in **Development Controller** and use its existing verified deployment workflows. The old direct-deploy workflow in this repository is removed by the collaboration setup to prevent two independent pipelines racing over the same Workers.

**Repository settings still matter:** maintainers must enable a branch ruleset requiring pull requests, CI and another person's approval. Until enabled, GitHub still permits direct pushes to unprotected `main`. See [WORKFLOW.md](docs/collaboration/WORKFLOW.md).

## Next deliverable

A reviewed, source-linked product/component export from acquisition, consumed by Patricio's **existing deterministic Python rules** (not duplicated in JS), then a **synthetic-only** supplier process-compatibility demonstration. Follow [Issues #2–#5](docs/collaboration/ACTIVE_WORK.md).
