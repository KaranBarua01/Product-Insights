# PI Evidence-First Research V3 (Prototype)

This branch is a **staged local research experiment** built on the V2 Adaptive Research branch and the V1 source-evidence verifier. It does not replace Cloudflare production, the original OEM taxonomy, D1 or InsideJob OS.

## Why this exists

The original PI scraper could discover many product/SKU candidates but frequently missed parts, materials and manufacturing evidence. The 50-page benchmark showed the failure is *page choice + content representation + identity attribution*, not simply page count. The initial V3 15-page live A/B also showed that overprioritizing unrelated material catalogs or replacement parts makes matters worse. The adjusted planner now distinguishes true documents from material *product categories* and defers replacement-parts navigation until a finished product is identified.

## Changes

1. `tools/research-v3.mjs`: exact-host, caller-safety-checked V3 frontier with bounded 5/15/30/50 requests, technical-document priority after product discovery, category saturation penalties, URL canonicalization and direct document-link provenance.
2. `src/html.ts` and `src/types.ts`: preserve actual HTML table row boundaries. These are raw source claims, not validated BOM information.
3. `tools/evidence-bridge-v3.mjs`: source-anchored, strict single-product manual/datasheet relationships (real PDF URL, quote and PDF page), technical HTML table claims, and conservative technical **product family** identification when unusual URLs do not follow `/product/...` conventions.
4. `tools/part-evidence-verifier.mjs`: broader, targeted component vocabulary (`inner body`, `hauling rope`) and material labels (PU), with a fix against attaching a material to a nearby unrelated part. Company-level D1 processes remain unverified priors only.
5. Existing graph receives V3 source evidence as review-only relationships; it never treats them as verified in-house capabilities.
6. `tools/v3-live-ab-benchmark.mjs`: identical 15- or 30-page V2 vs V3 website comparisons and an optional 50-page V3-only exploratory run, all from GitHub Actions artifacts.

## How to run locally

On the V3 feature branch and with the existing Windows Local Research Lab prerequisites:

```powershell
cd Scrappers
npm install
npm run build
$env:PI_RESEARCH_V3="1"
npm run lab
```

The existing Lab UI can continue requesting 5, 15, or 30 pages; the V3-only `/api/run` JSON request may specify up to **50**. The ordinary Worker remains unchanged. If `PI_RESEARCH_V3` is unset, existing V2 research remains the default. The response `partEvidence` includes source-backed candidate links and unverified D1 context; `documentLinks` lives in the research report. Do not enable for supplier qualification without manual review.

## Evidence policy

A document is eligible for part evidence only when **all** these tests pass: public source on the same approved host; the product's own visited page directly links the document; the document itself names that product/model; and the document has source text. If a shared manual names multiple sampled models or variants without a product-specific SKU, the verifier abstains. A family-level technical page may be treated as a **separate family candidate** when the primary H1, URL slug and multiple engineering signals agree. No generic family fact is automatically inherited by individual SKUs.

Quotes are traceable to the actual product/document URL; PDF pages and HTML table rows retain locators where present. A source claim is not a verified BOM, material specification or manufacturer capability. No access restriction circumvention or in-house process inference is implemented.

## Measurement and acceptance

**50% jump is a target, not a demonstrated claim.** An accurate calculation requires the same website cohort, matched page budgets, manual labels for distinct product->part relationships and precision (not only extracted record totals). SKU-level duplicates must be deduplicated; compare `distinctSourceParts` and `distinctFamilyParts` rather than raw candidate counts.

- CI QA: TypeScript build and source-boundary regression tests.
- Live A/B: `igus`, `bike`, `vacuum` at 15 pages per method.
- Deep exploratory: `igus`, `bike` at 50 pages V3-only (cannot claim this is a fair V2/V3 comparison).
- Manual review: separately validate part names and source quotations on 1UP Heavy Duty, igus e-loop and a specific pump model.

The work is a **prototype feature branch** and should stay as a draft PR until an independent reviewed benchmark establishes accuracy, acceptable performance and security. The original taxonomy and Cloudflare D1 remain unmodified.