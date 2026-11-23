# Product Insights — Company-independent Industrial Knowledge Foundation V2

## Scope
A reusable industrial product-engineering reference, **not** a map of companies to products. The source `company_commodity_dictionary` is used to mine vocabulary only. No individual company IDs/domains are persisted in the knowledge graph.

**Hierarchy:** Product Category -> Product Archetype -> Product Configuration -> Assembly -> Part Type -> Possible Material -> Conditional Manufacturing Route.

## Current D1 objects

Pre-existing:
- `pi_product_part_routes_v1` — editable engineering-route seed records. All rows have `knowledge_status='engineering_hypothesis'` unless independently reviewed.
- `pi_kb_names_v1` — canonical registry of ID/name/entity_type.
- `pi_kb_hierarchy_edges_v1` — typed ID-only category/archetype/configuration/assembly/part edges.
- `pi_kb_part_route_map_v1` — assembly + part + material + route IDs, source route reference, conditions, status.
- `pi_kb_route_step_map_v1` — ordered route steps using stable process-step IDs.
- `pi_kb_product_tree_v1` — human-readable seven-level SQL view.

V2 additions:
- `pi_kb_lexicon_v2` — aggregated corpus vocabulary from **all 27,441 source descriptions**, including product phrases, materials and commodities. Phrases are **not** confirmed product archetypes.
- `pi_kb_aliases_v2` — entity aliases, searchable without cloning canonical entities.
- `pi_kb_review_queue_v2` — proposed taxonomy and engineering additions subject to review.
- `pi_kb_sources_v2` — independent public engineering evidence for a route or entity, no company relationship tables.
- `pi_kb_corpus_runs_v2` — aggregate inventory provenance only.

## Essential rules

1. No company-to-product associations at this stage; no changes to `company_commodity_dictionary`.
2. Company-level `commodity` and `materials_required` fields are **not** part-specific ground truth.
3. A generic product archetype is **not** a verified BOM. An empty branch must remain empty rather than filled with guesses.
4. Alternatives are **conditional**: material + manufacturing route must be associated with an assembly/part occurrence; no Cartesian product across materials/processes.
5. Source-backed claims, independent engineering review and model hypotheses use separate statuses; generated content must never be labeled as verified by default.
6. Canonical ID relationships should be queried by `entity_id` and indexed; text-to-ID resolution should use `(entity_type, entity_key)`.
7. Keep ambiguous terms (e.g. 'controls', 'assemblies', 'service') in the unreviewed lexicon until classified; never automatically promote them to product types.
8. Review aliases and technical synonyms. The name 'stainless steel' does not automatically equal 'cast stainless steel' or a particular grade.
9. Hold out unseen technical source examples in future accuracy evaluation. Graph completeness is not accuracy.
10. Migrations and enrichment are additive and idempotent; do not drop old tables or write to production applications without separate authorization.

## Example queries

```sql
-- Look up one archetype and compatible engineering candidates.
SELECT archetype_id, product_archetype, configuration_id, product_configuration,
       assembly_id, part_id, part_type, material_id, material, route_id, manufacturing_route,
       engineering_conditions, knowledge_status
FROM pi_kb_product_tree_v1
WHERE archetype_id = 25;

-- Explore product-related corpus vocabulary; not verified products.
SELECT normalized_term, occurrence_count
FROM pi_kb_lexicon_v2
WHERE term_kind='product_phrase'
ORDER BY occurrence_count DESC LIMIT 100;

-- QA: All seed rows resolve into exactly one normalized mapping.
SELECT
 (SELECT COUNT(*) FROM pi_product_part_routes_v1) seed_count,
 (SELECT COUNT(*) FROM pi_kb_part_route_map_v1) mapped_count,
 (SELECT COUNT(*) FROM pi_kb_product_tree_v1) readable_count;

-- Review inventory.
SELECT proposal_type,review_status,COUNT(*) FROM pi_kb_review_queue_v2 GROUP BY 1,2;
```

## Limitations
Dictionary phrase mining uses comma/semicolon delimiters and lowercasing; it is a **candidate inventory** and preserves no individual company link. Several product phrases contain service descriptors and broad categories, and plurals/synonyms are not fully resolved. Confirmed product-to-part BOM evidence requires independent source review. The initial blueprint catalog is curated engineering reasoning, not exhaustive worldwide manufacturing knowledge.

## Development and deployment
This is a data-foundation prototype. Source of truth is existing Cloudflare D1 `chuck-intel-db`; no production engine deployment or JS1–JS10 integration is included. All new tables are prefixed `pi_kb_` and company independent.