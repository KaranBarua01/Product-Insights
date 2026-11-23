# Product Insights — Step 1 Product Normalization / V5 Execution Report

**Date:** 2026-11-23
**Database:** Cloudflare D1 `chuck-intel-db`
**Execution:** ChatGPT reasoning + deterministic SQL. No external AI services.
**Scope:** Company-independent industrial-product taxonomy; **no company/product links**.

## Bottom line: classification pass executed; semantic normalization is NOT complete

Every source vocabulary string has a traceable V5 resolution outcome, but **38,400 product phrases remain in a prioritized semantic-review queue** because their text alone cannot establish a unique product identity. Classifying a term as a broad family, system, part, process, or review-needed candidate is **not** the same as approving a product archetype.

- **Structural gate:** PASS (0 referential/integrity errors)
- **Semantic completion gate:** REVIEW_PENDING (38,400 product phrases)

Never report V5 as "53,415 product types fully normalized." The corpus is noisy and includes services, generic terminology, source placeholders and unrelated domains.

## Executed operations

1. Reconciled the prior 444 mapped product archetypes with 53,415 raw product phrases, 1,414 material phrases and 59 commodity/process tokens. All **54,888** raw strings now have one outcome row in `pi_kb_term_resolution_v5`.
2. Normalized case, common punctuation, plural variants and limited leading modifiers without altering original source strings. Matched to INJCODES with explicit match provenance. Retained ambiguous ID matches for review, never treating suffix matches as engineering proof.
3. Curated **264** recurring physical-product phrases:
   - **139** distinct provisional new archetypes, with parent category edges and unique INJCODES.
   - **69** synonyms/aliases pointing to existing archetype IDs.
   - **56** ambiguous product scopes quarantined rather than forced into misleading subtypes.
   - Four new duplicate or over-narrow proposals were withdrawn before final synchronization: forklift truck, electric motor starter, reverse-osmosis treatment unit and telescopic belt conveyor.
4. Added **192** explicit exceptions and **168** deterministic classification patterns. Terms are screened as broad product families, generic part types, manufacturing processes/services, specific candidate products, material phrases, nonindustrial domains, or context-required review items.
5. Preserved all original product engineering mappings and stored all pending work in prioritized D1 review views with reasons.

## Verified final D1 inventory

| Metric | Final |
|---|---:|
| Source lexicon records | 54,888 |
| Source product phrases | 53,415 |
| Strings with a V5 resolution record | 54,888 |
| Product phrases matched to archetype IDs | 379 |
| Product phrases screened or matched, not in pending semantic review | 15,015 |
| Product phrases needing semantic review | **38,400** |
| Product archetypes in INJCODES | **583** (444 original +139 provisional new) |
| New taxonomy-only archetypes | **139** |
| Product archetypes with seven-level manufacturing paths | **444** |
| INJCODES rows across all entity types | **3,744** |
| Original seven-level manufacturing paths preserved | **3,124** |
| Structural integrity failures | **0** |
| Historical duplicate same-name archetype labels | **1** ("Shaft coupling") |

**Important:** New archetypes have only category connections. They are not given fabricated configurations, assemblies, parts, materials or processes as part of Step 1. The 3,124 original routes remain `engineering_hypothesis`, without accepted external technical sources.

### Long-tail review counts (product phrases)

- 24,771 descriptions require additional context.
- 5,421 are specific-product candidates, not enough to safely create identities automatically.
- 5,349 are system-level candidates with unclear boundaries.
- 2,687 are ambiguous single-token phrases.
- Other pending categories (small): scope conflicts, service candidates, legacy matches, multiple-ID matches, etc.

These are distinct phrases in the corpus, **not** established engineering concepts. Their counts may change as review progresses.

## Operational D1 objects

- `pi_kb_term_resolution_v5` — complete lexicon dispositions with normalization, suggested category, matched INJCODE if defensible, confidence tier and reviewer status.
- `pi_kb_archetype_curation_v5` — per-phrase curator actions (new, alias-existing, scope-review).
- `pi_kb_taxonomy_archetypes_v5` — one row per registered archetype, category, and whether manufacturing mapping exists.
- `pi_kb_taxonomy_review_backlog_v5` — outstanding semantic review ordered by priority.
- `pi_kb_taxonomy_step1_scorecard_v5` and `pi_kb_taxonomy_step1_gate_v5` — honest completeness metrics.
- `pi_kb_phrase_exceptions_v5`, `pi_kb_resolution_patterns_v5`, `pi_kb_phrase_matches_v5`, `pi_kb_taxonomy_issues_v5` — source-driven classification and unresolved technical issues.

The two primary physical tables remain exactly **`INJCODES`** and **`Tree of Manufacturing`**. Other objects are normalized internal support tables or read-only views.

### Inspection queries

```sql
SELECT * FROM pi_kb_taxonomy_step1_gate_v5;
SELECT * FROM pi_kb_taxonomy_step1_scorecard_v5;

SELECT injcode_id,canonical_name,product_category,coverage_status
FROM pi_kb_taxonomy_archetypes_v5
ORDER BY product_category,canonical_name;

SELECT normalized_term,occurrence_count,disposition,suggested_category,review_priority
FROM pi_kb_taxonomy_review_backlog_v5
WHERE term_kind='product_phrase'
ORDER BY review_priority DESC LIMIT 100;

SELECT * FROM pi_kb_taxonomy_issues_v5 WHERE status='open';
```

## QA / safety

- `pi_kb_taxonomy_integrity_issues_v5`: zero rows.
- `pi_kb_taxonomy_integrity_issues_extra_v5`: zero rows.
- Every registered archetype has exactly one parent category in current curation output.
- New taxonomy-only archetypes have **zero** manufacturing configurations; later mapping is Step 2.
- All `pi_product_part_routes_v1`, internal mapping, readable view, and public `Tree of Manufacturing` show **3,124** rows each.
- `pi_kb_quality_issues_v4` and `pi_kb_integrity_issues_v2`: zero rows.
- SQLite `PRAGMA foreign_key_check`: no violations.
- No company-archetype link table created.
- One historical duplicate label `Shaft coupling` (IDs **612** and **1574**) retained and flagged. Merge should not happen without checking graph references and seed routes.

## GitHub deliverables

- `data/taxonomy-curation-v5.json` — curated decisions and known matches (264).
- `data/phrase-exceptions-v5.json` — exact exception rules (192).
- `data/resolution-patterns-v5.json` — deterministic patterns (168).
- `schema/step1-taxonomy-v5-snapshot.sql` — full V5 D1 schema snapshot.
- `sql/resolve-vocabulary-v5.sql` — deterministic lexical resolution and review tagging, company-independent.
- `tools/build-taxonomy-catalog-v5.mjs` — compile registry snapshots into idempotent D1 taxonomy/alias seed SQL.
- `qa/taxonomy-checks-v5.sql` — acceptance queries and gated completion.

The compiler and full fresh-database rebuild SQL are **versioned but not yet independently tested on an empty D1 replica**. Live D1 operations and read-only acceptance checks were executed successfully. Import on isolated test D1 with backups and do not approve any inferred identity without explicit scope review.

## Next decision boundary

The deterministic screening phase of Step 1 is done. **Complete semantic adjudication still requires reviewing 38,400 ambiguous/long-tail product phrases**, first prioritizing high-frequency specific products and collision-prone synonyms. Their complete source context often cannot be reconstructed from the isolated phrase. This is a legitimate knowledge limitation, not a missing database table.

Do not silently mark these as accepted products or generate their manufacturing trees. Once prioritized candidates are accepted, they can be assigned INJCODES and handed to Step 2 (configuration / assembly / parts / material / manufacturing mapping).
