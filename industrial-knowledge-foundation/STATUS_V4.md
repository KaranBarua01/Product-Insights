# Product Insights — Five-Step Industrial Knowledge Foundation V4.1

**Date:** 2026-11-23
**Database:** Cloudflare D1 `chuck-intel-db`
**Implementation:** Direct SQL + ChatGPT's engineering reasoning. **No external AI service** was called.
**Scope boundary:** Only a reusable industrial product/part/material/manufacturing knowledge base. No company-to-product association, company IDs or domain evidence stored in the product graph.

## Completed work

| Phase | Executed | Outcome |
|---|---|---|
| 1. Product normalization | Scanned and triaged all 54,888 previously mined vocabulary strings from 27,441 source dictionary rows. Applied deterministic lexical classifications, canonical lookups, candidate aliases and category suggestions. | `pi_kb_corpus_triage_v4`, `pi_kb_lookup_aliases_v4`, `pi_kb_corpus_priority_v4` |
| 2. Product hierarchy | Added 26 product archetypes, new archetype configurations and assembly relationships, retaining engineering context. | 32 categories, 444 archetypes, 532 configurations, 999 assemblies |
| 3. Part mapping | Added configuration-specific parts in machine tools, bulk materials, fluid power, HVAC, cameras, packaging/industrial accessories. | 579 unique part names |
| 4. Material + route mapping | Added 219 directly reasoned new seed paths and 315 conditional material-route alternatives from 18 explicit alternative rules. | 195 materials, 477 routes, 3,124 candidate paths |
| 5. Validation + synchronization | Rebuilt internal normalized entity IDs/edges/part routes and synchronized the public-facing `INJCODES` and `Tree of Manufacturing` tables. | 3,605 INJCODES IDs; 3,124 ID-only paths, 0 structural integrity issues |

## Exact distinction: vocabulary triage vs complete product taxonomy

The dictionary lexicon contains:
- 53,415 distinct product-description strings.
- 1,414 distinct material strings.
- 59 commodity/process terms.
- Total: **54,888** strings; all were assigned a triage classification.

This is **not** 54,888 validated engineering concepts. The majority of phrases are unresolved or require review; many describe services, equipment categories, broad nouns or incomplete product descriptions. Classification and lexical category inference are review aids, not production-grade product identification.

## Operational tables

**Two primary physical tables:**
- `INJCODES` — canonical IDs, entity types, names and keys.
- `Tree of Manufacturing` — one row per **valid candidate combination** of seven IDs, engineering conditions and knowledge status.

**Internal/derived objects:**
- `pi_product_part_routes_v1`: human-readable seed rows and engineering conditions.
- `pi_kb_names_v1`, `pi_kb_hierarchy_edges_v1`, `pi_kb_part_route_map_v1`, `pi_kb_route_step_map_v1`: internal normalized identity and relationship mappings.
- `Tree of Manufacturing - Part Options`: one row per scoped part, preserving the pairing of material and manufacturing route.
- `Tree of Manufacturing - Nested`: one row per category, nested archetype -> configuration -> assembly -> part -> material/route options.
- `pi_kb_corpus_triage_v4`, `pi_kb_corpus_priority_v4`, `pi_kb_lookup_aliases_v4`: corpus processing and candidate review.
- `pi_kb_material_route_rules_v4`: explicit alternative-material and route logic, with conditions.
- `pi_kb_archetype_coverage_v4` and `pi_kb_coverage_gap_v4`: identify thin and missing knowledge.
- `pi_kb_quality_issues_v4`: count stale, missing or inconsistent data.

The internal graph remains the write/curation model; `INJCODES` and `Tree of Manufacturing` are synchronized read-facing physical tables. They are **not** automatically synchronized on arbitrary manual edits. Run the checked synchronization statements after any expansion.

## Validated checks

- `pi_product_part_routes_v1`: **3,124**
- `pi_kb_part_route_map_v1`: **3,124**
- `pi_kb_product_tree_v1`: **3,124**
- `Tree of Manufacturing`: **3,124**
- `INJCODES`: **3,605**
- Source dictionary rows unchanged: **27,441**
- Corpus triage rows: **54,888**, equal to lexicon rows
- `pi_kb_quality_issues_v4`: **0**
- Ambiguous category/name assignments per archetype key: **0**
- Manufacturing route names with conflicting step sequences: **0**
- Foreign-key violations: **0**
- Company-to-archetype linking tables: **0**
- Cross-checked all **eight** version-controlled seed packs: 3,124 unique route IDs and unique engineering paths, zero duplicate/invalid step/status errors.

## Engineering quality and remaining work

**Not a fully validated industrial ontology.** Every route is `engineering_hypothesis`. There are **zero accepted independent technical sources** and **zero reviewed routes**.

Coverage diagnostics indicate:
- 358 archetypes currently have only one configuration.
- 72 archetypes have fewer than five distinct mapped parts.
- All 444 archetypes need independently supported engineering relationships.
- No claim that the 53k raw product strings have been completely resolved into product archetypes.

The current maps are plausible candidate manufacturing possibilities, subject to geometry, thermal loading, pressure rating, corrosion, material grade, volume, safety/code requirements and detailed design. A route doesn't prove an OEM actually manufactures a particular component.

### Versioned source and QA

- `data/route-candidates-v2.json`, `data/routes-v3.0-A.json` to `E.json`
- `data/routes-v4.1-curated.json` — 219 hand-reasoned new candidate paths
- `data/routes-v4.1-alternatives.json` — 315 material-route alternatives generated from explicit conditions
- `data/material-route-rules-v4.json` — 18 conditional engineering rules
- `data/curated-phrase-aliases-v4.json` — 28 candidate aliases (not blindly accepted as engineering facts)
- `tools/build-all-seed-sql-v4.mjs` — compile eight versioned packs into deterministic, idempotent seed SQL with validation.
- `sql/corpus-triage-v4.sql`, `sql/category-suggestions-v4.sql` — deterministic lexical processing.
- `sql/sync-normalized.sql`, `sql/INJCODES_and_Tree_of_Manufacturing.sql` — synchronize both ID mapping layers.
- `qa/foundation-checks-v4.sql` — end-to-end acceptance queries.
- `schema/snapshot-v4-20261123.sql` — schema reference for new stages and primary tables.

Run order (on isolated development D1 and with backups):
1. Apply reviewed base schema and V4 additions.
2. Run `node industrial-knowledge-foundation/tools/build-all-seed-sql-v4.mjs`.
3. Inspect generated SQL, then import it.
4. Run `sql/sync-normalized.sql` and `sql/INJCODES_and_Tree_of_Manufacturing.sql`.
5. Run corpus triage + category suggestion SQL.
6. Run `qa/foundation-checks-v4.sql`; do not promote unreviewed relationships to verified.

**Immediate next research work:** Review high-frequency unresolved product phrases; deepen configuration BOMs; obtain independent engineering source references for the most consequential relationships; measure product-family coverage/precision on held-out cases. No company associations until separately authorized.
