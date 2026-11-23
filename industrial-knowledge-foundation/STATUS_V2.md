# Industrial Knowledge Foundation V2 — verified build ledger
Date: 2026-11-23. D1: `chuck-intel-db`. Product Insights V4 research foundation; **not a production deployment**.

## Goal and scope
Reusable, company-independent industrial graph:
Category -> Archetype -> Configuration -> Assembly -> Part Type -> Possible Material -> Conditional Manufacturing Route.
No company->product mapping. The existing `company_commodity_dictionary` is used only to derive **aggregated terminology**, not evidence that any particular company makes a product.

## Executed and observed
- **27,441 dictionary records** inspected; original rows unchanged.
- **53,415** unique product-description phrases (raw/unreviewed, including services and false positives).
- **1,414** distinct material tokens (raw/unreviewed).
- **59** distinct commodity/process tokens (raw/unreviewed).
- **27** canonical product categories.
- **66** canonical product archetypes.
- **67** product configurations and **67** assemblies.
- **202** canonical part-type labels.
- **80** material labels; **187** distinct manufacturing-route labels.
- **228** candidate assembly/part/material/route mappings, **228** readable joined paths.
- **630** candidate reviews queued: 450 product/archetype phrases and 180 material terms.
- **0** accepted independent source records. **0** verified routes.
- **0** integrity-view problems; `PRAGMA foreign_key_check` returned no violations.

The seed engineering mappings are reasoned **hypotheses**, not verified BOMs. Every mapped alternative has a stated engineering condition. Some initial archetypes are broad by design; they do not automatically share the same internals across models. Manufacturing operations can be sequenced and reused, but an engineering method is not proof of in-house capability.

## Database components
**Existing normalized graph**
- `pi_kb_names_v1`: names, globally stable entity IDs, entity type and canonical keys.
- `pi_kb_hierarchy_edges_v1`: ID-only typed category->archetype->configuration->assembly->part relationships.
- `pi_kb_part_route_map_v1`: ID-only compatible part+material+route combinations scoped by assembly.
- `pi_kb_route_step_map_v1`: ordered process steps with canonical IDs.
- `pi_kb_product_tree_v1`: readable hierarchy view.
- `pi_product_part_routes_v1`: editable seed staging table with conditions and status.

**V2 discovery and governance**
- `pi_kb_lexicon_v2`: aggregate dictionary-mining inventory; **not** promoted into canonical product names.
- `pi_kb_aliases_v2`: candidate lookup aliases (currently includes canonical search variants; review before use as synonyms).
- `pi_kb_review_queue_v2`: independent reviewed/pending proposals.
- `pi_kb_sources_v2`: independent source evidence, URLs and claim locators; empty pending collection.
- `pi_kb_corpus_runs_v2`: corpus processing audit metadata.
- `pi_kb_quality_summary_v2`: one-row QA metrics.
- `pi_kb_integrity_issues_v2`: missing, duplicate or structurally malformed graph paths.

## Important discovery
Category edges must not fan out to unrelated configurations. The first V2 QA found one archetype (`pipe_fitting`) assigned to both Fluid Handling and Mechanical Components, causing **234 view rows for 228 mappings**. Category ownership was normalized to Mechanical Components; QA now gives exactly **228/228**. Future multiple-parent taxonomies should use explicitly scoped archetype-category mappings rather than implicit cross-product joins.

## Lookup examples
```sql
SELECT archetype_id, product_archetype, configuration_id,
       assembly_id,part_id,part_type,material_id,material,
       route_id,manufacturing_route,engineering_conditions,
       knowledge_status
FROM pi_kb_product_tree_v1
WHERE product_category='Fluid Handling';

SELECT normalized_term,occurrence_count
FROM pi_kb_lexicon_v2
WHERE term_kind='product_phrase'
ORDER BY occurrence_count DESC LIMIT 50;

SELECT proposal_type,proposal_json,rationale
FROM pi_kb_review_queue_v2
WHERE review_status='pending'
ORDER BY review_id LIMIT 50;

SELECT * FROM pi_kb_quality_summary_v2;
SELECT * FROM pi_kb_integrity_issues_v2;
```

## What is not complete
This is a functioning data and governance **foundation prototype**, not a complete ontology of all industrial manufacturing. The 53k scraped phrases are not 53k validated product archetypes. Expansion to all relevant archetypes, 2+ configurations per major archetype, engineering validation of part/material/process compatibility, and independently reviewed reference evidence are outstanding. The dataset cannot yet support claims of high precision/recall or universal website coverage.

## Rules for further work
1. No company association before explicitly approved product identity phase.
2. New archetypes/assemblies/parts should be deduplicated by canonical key, scope and engineering definition—not name alone.
3. Do not cross-join a part's entire material set with its entire route set; routes are conditional combinations.
4. Preserve source/locator and status for every accepted engineering relationship.
5. Never treat a distributor's offered products, or company-level commodities, as proof of internal manufacturing.
6. Hold out a cross-industry review dataset before using new mappings to evaluate research engines.
7. Material/part/route confidence is not inherited automatically from parent category confidence.
8. Use the QA SQL before and after migration; retain backups and versioned source packs.
