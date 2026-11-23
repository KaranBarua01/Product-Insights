-- Product Insights Industrial Knowledge Foundation V5 / STEP 1 read-only acceptance checks.
-- Check structure separately from semantic review completion.
-- All source strings are classified, but review-required phrases must NOT be counted as canonical products.

SELECT * FROM pi_kb_taxonomy_step1_scorecard_v5;
SELECT * FROM pi_kb_taxonomy_step1_gate_v5;
SELECT * FROM pi_kb_taxonomy_summary_v5;

-- Curation provenance: new IDs, known aliases, and intentionally quarantined phrases.
SELECT decision,COUNT(*) AS phrases
FROM pi_kb_archetype_curation_v5 GROUP BY decision ORDER BY decision;

-- Physical taxonomy identity is distinct from complete seven-level engineering mapping.
SELECT coverage_status,COUNT(*) AS archetypes
FROM pi_kb_taxonomy_archetypes_v5
GROUP BY coverage_status ORDER BY coverage_status;

-- Show highest-value pending review work.
SELECT term_id,normalized_term,occurrence_count,disposition,review_priority,
       suggested_category,decision_basis
FROM pi_kb_taxonomy_review_backlog_v5
WHERE term_kind='product_phrase'
ORDER BY review_priority DESC,occurrence_count DESC LIMIT 100;

SELECT disposition,review_state,phrases,occurrences
FROM pi_kb_taxonomy_review_summary_v5
ORDER BY phrases DESC LIMIT 50;

-- Fully classified = number of raw lexicon records equals number of final outcome records.
SELECT (SELECT COUNT(*) FROM pi_kb_lexicon_v2) AS lexicon_terms,
       (SELECT COUNT(*) FROM pi_kb_term_resolution_v5) AS resolution_records,
       (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 WHERE disposition='needs_context') AS unclassified_records;

-- All explicitly approved new taxonomy-only archetypes need one category, unique IDs and no inferred routes.
SELECT COUNT(*) AS uncategorized_archetypes
FROM pi_kb_taxonomy_archetypes_v5 WHERE product_category IS NULL;
SELECT issue_type,COUNT(*) n FROM pi_kb_taxonomy_integrity_issues_v5 GROUP BY issue_type;
SELECT issue_type,COUNT(*) n FROM pi_kb_taxonomy_integrity_issues_extra_v5 GROUP BY issue_type;

-- Existing same-name different-ID records may be historically mapped; investigate before merging.
SELECT LOWER(name) AS label,COUNT(*) AS id_count,GROUP_CONCAT(injcode_id) AS distinct_ids
FROM INJCODES WHERE entity_type='archetype'
GROUP BY LOWER(name) HAVING COUNT(*)>1;

-- The public Tree and existing internal mappings must not drift after taxonomy-only imports.
SELECT (SELECT COUNT(*) FROM pi_product_part_routes_v1) AS seed_paths,
       (SELECT COUNT(*) FROM pi_kb_part_route_map_v1) AS id_paths,
       (SELECT COUNT(*) FROM pi_kb_product_tree_v1) AS readable_paths,
       (SELECT COUNT(*) FROM "Tree of Manufacturing") AS public_paths,
       (SELECT COUNT(*) FROM INJCODES) AS injcode_entries;
SELECT COUNT(*) AS new_archetypes_with_unintended_routes
FROM pi_kb_taxonomy_archetypes_v5
WHERE record_status='provisional_corpus_taxonomy_v5' AND configuration_count>0;

SELECT COUNT(*) AS public_knowledge_integrity_errors FROM pi_kb_quality_issues_v4;
SELECT COUNT(*) AS existing_integrity_errors FROM pi_kb_integrity_issues_v2;

-- Strict scope: there should be no company-to-archetype mapping table.
SELECT COUNT(*) AS company_archetype_link_tables
FROM sqlite_master WHERE name='pi_company_archetype_links_v1';

PRAGMA foreign_key_check;
