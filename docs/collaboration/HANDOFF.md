# Product Insights — Karan + Patricio engineering handoff

**Snapshot:** 12 November 2026. **Source repository:** `KaranBarua01/Product-Insights` (PUBLIC). **Production-release repository:** `KaranBarua01/development-controller`.

## One-sentence system objective

Connect **website-acquired evidence** to **reviewed product/component facts**, then Patricio's **deterministic manufacturing-process inference and synthetic supplier matching**, while preserving source traceability and keeping compatibility distinct from actual manufacturing qualification.

## What is already implemented

**Karan / acquisition lane**
- `engine/pattern-systems/`: website pattern taxonomy, sampled detection, API and existing `insidejob-pattern-systems` Cloudflare Worker.
- `Scrappers/`: S01 HTTP/HTML, S02 browser (Playwright independently tested), S03 PDF text, router, robots/host safety, evidence, optional Workers AI and a live demo. Existing Worker: `product-insights-scrappers-prototype`.
- `Scrappers/src/js-profile.ts`: JS1–JS10 sections populated as **source-quoted AI proposals**, not validated engineering records. `POST /api/insights/analyze` accepts `buildProfile:true` for allowlisted, authenticated sites.
- Demo supports 14 approved test hostnames; research benchmark is in the controller. The 100-site benchmark measures bounded extraction and *provisional* research agreement, not verified manufacturing intelligence.
- There is **no finished component graph**, verified BOM, purchasing-demand classifier or persistent InsideJob OS intelligence interface.

**Patricio / manufacturing lane**
- A separate Python handoff exists outside this repo. It contains deterministic manufacturing-process inference (phase 1), supplier capability matching (phase 2), rules, taxonomy mappings and tests. Reported standalone test suite: 53 passing tests.
- The pilot example is Busch R5 RA 0100 F: 16 proposed process requirements across four studied components; two purchased components excluded; 10 **synthetic** suppliers tested for process compatibility; ShopRadar taxonomy involved.
- `Scrappers/src/patricio-pilot.ts` is a **static, sanitized output snapshot** for demo only. It does **not** execute Python, call Patricio's code or verify OEM source facts.
- Patricio's exact current Python package **has not been committed to this repository** and its private inputs/blueprint transcriptions must not be copied into the public repo without permission.

**Shared / not yet built**
- A reviewed source-evidence → product/component/role → engineering-input contract that both programs accept.
- A live integration adapter, independent verification of original OEM data, real supplier database integration or supplier qualification.
- A tested end-to-end workflow joining the two executable engines. No new Cloudflare Worker is required just for collaboration.

## Ownership — no overlapping implementations

| Primary DRI | Allowed core area | Must not silently implement |
|---|---|---|
| **Karan** | `engine/pattern-systems/`, `Scrappers/`, JS1–JS10 acquisition/UI, evidence capture | A second manufacturing-process rules engine or supplier capability matcher |
| **Patricio** | `intelligence/manufacturing/` Python process inference, supplier matching, taxonomy | A second crawler, Pattern Systems engine or Cloudflare scraper |
| **Joint (both review)** | `contracts/`, future `integration/` bridge | A private schema changed independently on either side |
| **Karan, consulting Patricio** | `.github/`, controller release pin and deployment safety | Modifying Patricio's Python code without an explicit integration task |

Canonical capability IDs and folders: [workstreams.json](../../collaboration/workstreams.json).

## Required first work items

- [#1 Coordination and PR boundaries](https://github.com/KaranBarua01/Product-Insights/issues/1): Karan sets up guardrails; both adopt the workflow.
- [#2 Acquisition facts export](https://github.com/KaranBarua01/Product-Insights/issues/2): Karan prepares source-linked, reviewed, typed component/product facts.
- [#3 Import Python engine](https://github.com/KaranBarua01/Product-Insights/issues/3): Patricio brings his existing deterministic code and synthetic tests into `intelligence/manufacturing/`; no rewrite.
- [#4 Joint contract](https://github.com/KaranBarua01/Product-Insights/issues/4): both review real Python I/O before freezing a schema.
- [#5 End-to-end synthetic pilot](https://github.com/KaranBarua01/Product-Insights/issues/5): after #2, #3, #4, connect via an adapter and surface rule/evidence/uncertainty in the demo.

**Do not start #5 by duplicating either engine.** Prepare independent work on #2 and #3 while both review #4.

## Important data meanings

- **JS1:** company identity/role (OEM vs manufacturer vs supplier vs distributor may overlap); **JS2:** product groups; **JS3:** products and components; **JS4:** materials; **JS5:** process requirements or process evidence; **JS6:** a company's *actual* declared capabilities; **JS7:** explicit sourcing signals, not assumed RFQs; **JS8:** markets; **JS9:** specific differentiators; **JS10:** provenance, confidence and coverage.
- A website quote supports **what was published**. It does not certify a product BOM, process, material, ownership, manufacturing capability, commercial opportunity or demand.
- Patricio's process outputs are **hypotheses with conditions**, not manufacturing guarantees. Matching a supplier's declared process to a requirement does not qualify that supplier.
- Until independently reviewed, manufacturing roles and material grades should be `unknown` or `hypothesis`; an AI suggestion is not an approved engineering input.

## Practical handoff for Patricio — first day

1. Confirm you can access `KaranBarua01/Product-Insights` and open Issues #3 and #4.
2. Clone, branch from updated `main`: `git switch -c feat/manufacturing-import`.
3. Inspect `intelligence/manufacturing/README.md` and the `contracts/proposals/` **nonfinal** example. Compare to your original input/output schema; comment on #4 instead of silently changing Karan's DTOs.
4. Import only redistributable Python code/tests into the canonical manufacturing folder. Keep historical outputs and private blueprints out of the public repository; create sanitized test cases.
5. Re-run your deterministic tests, document Python version / dependencies / taxonomy version / synthetic-only gating.
6. Open PR `MANUFACTURING` linked to #3. Karan reviews shared impacts, not individual domain assumptions. Do not edit `Scrappers/` or a production workflow in this PR.

## Practical handoff for Karan

1. Own #2 and the acquisition-side adapter: define source, review status and product/component boundaries without pretending that AI inferred parts are verified.
2. Review Patricio's actual I/O artifacts in #4. Do not implement a competing JS manufacturing inference engine.
3. Approve only a versioned integration contract that both sides can validate with fixtures.
4. Own UI integration and controller promotion after #5 passes; never have both source repo and controller deploy the same Worker.

## How code gets to production

Feature branches → PR + CI + other engineer's review → merge `Product-Insights/main` → **manual/reviewed promotion** of that commit SHA in `development-controller` → existing Worker deployment and live smoke checks.

This repo's direct Cloudflare deploy workflow is intentionally removed in the collaboration setup. GitHub branch protection must be enabled separately by a maintainer; see [WORKFLOW.md](WORKFLOW.md).

## What a successful joint milestone looks like

A **sanitized**, reviewed product with source-linked component facts is accepted by Patricio's deterministic Python engine, which produces conditional process requirements; supplier matching runs only against **synthetic** examples; the demo shows the source → fact → rule → conditional process → synthetic compatibility trail, including unknowns and exclusions.

This is the first real integration milestone, **not** a production supplier qualification platform.
