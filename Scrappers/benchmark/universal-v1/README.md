# Independent 30-company Universal Product Insights evaluation

**Purpose:** Assess whether an unchanged Product Intelligence V1 generalizes beyond the original InsideJob OS ten-company test. This is NOT universal certification.

## Fixed experimental design

- Old OS10 is a regression/development cohort, NOT a source of independent accuracy estimates.
- U30 is 30 candidate websites across ten sectors (three per sector), fixed in five batches A-E of six companies each. Sampling includes manufacturers, distributors, mixed businesses and service firms; the role_stratum metadata is a **selection hint, not a reviewed truth label**.
- Cohort file, exact hostname allowlist, current Product Intelligence extractor and Research Planner are pinned to their Git blob hashes in cohort-lock.json. Any change fails validation before network access.
- The source files already used for prior benchmarks (OS10 and the Scrappers 25-site example list) are explicitly excluded by normalized host. Other historical ad-hoc tests may have included some selected domains; the entire research history was not independently audited, so this is an independently selected *development holdout*, not a statistically random blind sample.
- No changes to extraction heuristics, prompts, patterns or company-specific routing after seeing these outcomes. Future changes must be scored on a fresh independent cohort, not resold as unseen improvements here.
- Each site has a maximum of 12 pages; 65-second per-site budget, 9-second extraction timeout, exact-host robots-compliant S01 with optional S02 browser and S03 PDFs. No bypasses.
- Results, evidence and review sheets stay in gitignored local-data on the Windows PC. Bounded summaries only return to the PRIVATE GitHub queue.

## Preflight (zero live requests)

From the Scrappers directory, after installing dependencies:

~~~sh
npm test
node tools/universal-benchmark.mjs --dry-run
~~~

Preflight verifies all Git pins and sector/batch distribution. It rejects overlap with known prior cohorts and any unapproved target domain. Note that a candidate domain is not permission to disregard website access restrictions.

Five fixed agent actions: u30_a, u30_b, u30_c, u30_d, u30_e. They require the local, opt-in PI_AGENT_ALLOW_U30=1 flag in the user's running Windows agent. Each selects one non-configurable six-site batch; the private queue cannot specify URLs, scripts or shell commands. Execute batch A first, then assess before B-E.

For an explicit local command, no agent queue needed:

~~~sh
node tools/universal-benchmark.mjs --batch A --out local-data/pi-local-agent/outputs/manual_20261119-u30A
~~~

## Files produced per batch

- summary.json: extraction/source signals, provisional candidate counts and failures. All accuracy fields remain UNREVIEWED.
- results.json: source-grounded candidate products, specifications, materials, components and evidence-traceability anomalies.
- manual-review.csv: independent deterministic sample (up to five products per site plus up to three attributes each, selected by a fixed hash), category and company-role source claims. All labels blank.
- manual-role-review.csv: independently completed **blinded company role** form. OEM/manufacturer, distributor, services, contract manufacturing and mixed are not prepopulated with the engine's prediction.

## Proper measurement

- Reachability and page counts measure acquisition execution, not catalog completeness.
- Product counts measure raw candidate records, not correct product families, and variants may duplicate.
- Quote match rate measures whether the emitted excerpt can be found in fetched source content. It does NOT establish its truth or correct product attribution.
- Company service businesses may correctly have no own-brand SKUs; an empty product list cannot automatically fail.
- Human-reviewed precision = correct/(correct+incorrect) among adjudicated sampled claims. Unknown decisions are excluded, but separately counted.
- Full product recall **cannot** be measured without independently compiling an exhaustive reference catalog for each company.
- The initial cohort is mostly English and not geographically representative. A later multilingual and regional cohort is required for a stronger generalization claim.

## Human adjudication

1. Make a separate copy of manual-review.csv named manual-reviewed.csv in the SAME local output folder, preserving all source and claim fields.
2. For every selected row, independently inspect the linked official source and determine whether the product identity and specific attribute refer to that correct product and company. Enter review_decision: correct, incorrect or uncertain, plus reviewer and optional review_note. Mere quotation matching is not sufficient.
3. Independently fill manual-role-review.csv with citations and explicit manufacture/distribution/service distinctions, not using the engine's guessed role as truth.
4. Score the reviewed claim sample with the local evidence-preserving scorer:

~~~sh
node tools/universal-review-score.mjs --template local-data/pi-local-agent/outputs/JOB-u30A/manual-review.csv --reviewed local-data/pi-local-agent/outputs/JOB-u30A/manual-reviewed.csv --out local-data/pi-local-agent/outputs/JOB-u30A/human-score.json
~~~

The scorer refuses modified source quotes and other source-row fields. If no labels exist, precision is null. This measures precision on a selected sample, not recall or universe-wide performance. A second reviewer should independently adjudicate a portion of the sample to quantify disagreement.

## After this V1 baseline

Record all five batch outcomes without hiding blocked sites. Evaluate source mismatches, role-attribution errors, duplicate product variants, technical evidence coverage and abstentions. Do not alter V1 during this locked evaluation. Develop V1.1 with general changes supported by regression/development evidence; use a newly selected test set to verify out-of-sample improvements.

No manufacturing-process, RFQ, supplier qualification, taxonomy modification, or OS production integration is included.
