# Product Intelligence Extractor V1

**Status:** candidate-generation prototype. All extracted records remain unverified until source review. This is not a manufacturing-process inference engine and does not modify the InsideJob OS.

## Problem addressed

The 19 November 2026 seven-company depth benchmark showed that permitted product detail and category pages yielded real text without consistently yielding JSON-LD Product records (especially 1UP USA) and that `/productcategory/` pages needed explicit recognition (CMC Supply). A site can provide usable HTML without our engine having product intelligence.

## Source-to-entity contract

`Company -> observed Product Category -> Product -> Specifications, Components, Materials`

- **Company:** host-scoped input identity. Company role is an *unverified candidate* derived from explicit company-identity page statements via existing `identifyCompanyRole()`. No business role is deduced from having a product catalog.
- **Category:** direct heading on a recognized category page, including `/productcategory/`, `/product-category/`, `/collections/` and `/categories/`. Category-to-product relations require an observed same-host product link on that category page.
- **Product:** original JSON-LD Product/ProductGroup name/SKU or an actual same-host product-detail page heading. General headings, product listing menus, company history, gift cards and blocked pages do not become products. Published metadata and visible headings have distinct evidence methods.
- **Specifications:** only explicit labeled fields and narrowly scoped published load-capacity statements. Record property, original value/unit and source quote, never inferred tolerances or technical specs.
- **Components:** only explicit inclusion language (includes, contains, equipped with, comes with, features, consists of) plus supported component nouns. Optional, separately sold and compatible-only statements are excluded. No BOM is inferred.
- **Materials:** explicit composition statements such as “made from aluminum” or “Material: stainless steel” on the identified product page. Do not transfer composition from category pages or unrelated products.
- **Unknown:** missing fields remain absent; `companyProductRole: manufactured_vs_sold_not_determined` prevents supplier/distributor misattribution.

Each candidate has `sourceUrl`, `quote`, `method` and `reviewStatus`. All full candidate records remain local until reviewed.

## Integration

`tools/product-intelligence.mjs` is a deterministic library consuming existing `extract()` outputs. It is called from the existing Local Research Lab, where `productIntelligence` is included in the JSON report and rendered in expandable tables.

`tools/product-intelligence-benchmark.mjs` uses the existing research planner `runResearch()` and S01/S02/S03 extractors to obtain fresh evidence for seven known accessible benchmark domains. The previous depth benchmark stored aggregate metrics/short snippets only; it **did not preserve complete source-page text**, so an accurate attribute extraction requires a new bounded fetch. Respect robots, 403/429 responses, host restrictions, page/time/byte budgets and the original query routing policy.

Private agent operation: `products_7`, enabled by a local opt-in `PI_AGENT_ALLOW_PRODUCTS_7=1`. No arbitrary URLs/scripts/PowerShell commands. Results saved to gitignored `local-data/pi-local-agent/outputs/<job>-products7/{summary,results}.json`; only a bounded source-linked sample is written to the PRIVATE queue. No private taxonomy or credentials are published.

## Success metrics for next live test

- Number of distinct candidate products discovered without JSON-LD, especially 1UP USA.
- CMC Supply's productcategory pages converted into actual category entities.
- For each company, number of product entities with source-backed specifications/materials/components.
- Exact quote match rates and percentage of records requiring review; review must detect any incorrect attribution.
- Differential between first 3 and up to 12 pages of the **same** new crawl.
- Per-site blocked/failure rate, duplicate URLs and remaining frontier.

A high record count is not a quality score. The extractor is a **first pass**, with a separate human-adjudicated validation set needed before any production OS adoption.

## Development checks

`npm test` in `Scrappers/` plus `node tools/product-intelligence-benchmark.mjs --dry-run`. Synthetic offline fixtures cover 1UP without JSON-LD, Hoshizaki labels, CMC category paths, identity segregation, false giftcard/companyhistory leads, component/material evidence, source quote confinement, duplicate handling, fixed-host scope and private job protocol.
