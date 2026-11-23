# Product Insights Industrial Knowledge Foundation — V3 bulk-build report

**Date:** 2026-11-23. **System:** Cloudflare D1 `chuck-intel-db`. **Scope:** reusable industrial product knowledge only. No company connections.

## Completed in this build

The original source dictionary has 27,441 rows and was **not modified**. Its previously mined company-independent vocabulary inventory contains 53,415 product-description phrases, 1,414 material strings and 59 commodity/process strings. These include generic words, services and duplicates; they are **not** 53k validated archetypes.

Five engineering-modeling passes, labeled `v3.0-A` through `v3.0-E`, expanded and corrected the candidate hierarchy to:

| Level or asset | D1 count |
| --- | ---: |
| Product categories | 32 |
| Product archetypes | 418 |
| Product configurations | 480 |
| Assemblies | 895 |
| Canonical part-type names | 417 |
| Material names | 151 |
| Manufacturing-route names | 363 |
| Part/material/route mapping rows | 2,590 |
| Resolved readable hierarchy paths | 2,590 |
| Pending terminology review proposals | 630 |
| Accepted independent technical evidence | 0 |

**No route has been marked reviewed or source-supported.** They remain engineering hypotheses. A mapped manufacturing route is a possibility conditional on configuration and design—not a BOM assertion, not an OEM capability claim, and not universally applicable.

## D1 tables and views

- `pi_product_part_routes_v1` — denormalized human-readable seven-layer seed records, each with conditions and `knowledge_status`.
- `pi_kb_names_v1` — canonical identity, numeric `entity_id`, type and `entity_key`.
- `pi_kb_hierarchy_edges_v1` — ID-only category to archetype to configuration to assembly to part edges.
- `pi_kb_part_route_map_v1` — ID-only assembly, part, material and route combination; status, conditions and seed route ID.
- `pi_kb_route_step_map_v1` — ordered manufacturing steps with canonical IDs.
- `pi_kb_product_tree_v1` — full readable seven-level join.
- `pi_kb_lexicon_v2` — discovery inventory from original dictionary, no company link.
- `pi_kb_review_queue_v2` — pending proposals; reviewer workflow not automated.
- `pi_kb_sources_v2` — structure for independent technical source evidence; currently empty.
- `pi_kb_quality_summary_v2`, `pi_kb_integrity_issues_v2` — QA views.
- `pi_kb_aliases_v2` and `pi_kb_corpus_runs_v2` — lookup/audit metadata.

## Version-controlled implementation

- `data/route-candidates-v2.json` — original 228 rows.
- `data/routes-v3.0-A.json` through `data/routes-v3.0-E.json` — additional 2,362 model-generated rows after corrections.
- `tools/build-all-seed-sql-v3.mjs` — compiles route packs into idempotent seed SQL and validates counts, uniqueness, engineering conditions, sequential steps and archetype/category identity.
- `sql/sync-normalized.sql` — resolves human-readable seed rows into normalized ID-only mapping tables.
- `qa/foundation-checks.sql` — independent read-only integrity queries.
- `schema/snapshot-20261123.sql` — D1 structure snapshot, including V2 governance structures.
- `sql/mine-dictionary.sql` — aggregate vocabulary discovery.

Suggested rebuild in an isolated **development** D1 database:
```sh
node industrial-knowledge-foundation/tools/build-all-seed-sql-v3.mjs
# Inspect migrations and generated files before importing.
# Apply schema/snapshot-20261123.sql in dependency-safe order.
# Apply data/seed-all-v3-generated.sql.
# Apply sql/sync-normalized.sql.
# Run qa/foundation-checks.sql.
```
The script generates SQL; it does not connect to Cloudflare, deploy software, or mutate D1.

## Quality assurance executed in D1

- Original source row count unchanged: **27,441**
- All seed mappings: **2,590**
- All ID-only mapping rows: **2,590**
- All resolved tree view rows: **2,590**
- Orphaned/multiplied mapping paths: **0**
- Archetypes linked to multiple categories: **0**
- Archetype keys linked to conflicting canonical names: **0**
- Foreign-key errors: **0**
- Company-to-archetype mapping tables: **0**

## Remaining limitations — not concealed

1. **Not all industrial products mapped:** Most of the 53,415 raw dictionary phrases still await deduplication, classification and human/domain review. Many phrases are not product types.
2. **Not full technical BOMs:** Typical candidate part sets are intentionally skeletal; alternative materials and routes require real configuration-specific engineering.
3. **No independent technical citations accepted yet:** There is currently no verified product→part→material→route ground truth.
4. **Data model is not fully ontology-normalized:** Canonical parts/material names may still need synonym and grade harmonization; manufacturing route step definitions remain textual.
5. **Need accuracy benchmarks:** Review across diverse industrial families and hold out unseen examples before using this foundation as reliable manufacturing inference.

## Recommendation

Use this as the **bulk-generated V3 candidate foundation**. Next milestone: review and promote the highest-relevance archetypes, expand subassemblies, and add external engineering evidence. Do not silently promote unreviewed terms to canonical product archetypes or connect companies before the product identity phase is explicitly authorized.
