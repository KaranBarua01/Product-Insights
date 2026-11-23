-- Product Insights Industrial Knowledge Foundation V4: read-only acceptance checks.
-- No company-to-product links. D1: chuck-intel-db.

-- All three representations must contain exactly the same number of candidate paths.
SELECT
  (SELECT COUNT(*) FROM pi_product_part_routes_v1) AS source_routes,
  (SELECT COUNT(*) FROM pi_kb_part_route_map_v1) AS internal_id_routes,
  (SELECT COUNT(*) FROM pi_kb_product_tree_v1) AS readable_routes,
  (SELECT COUNT(*) FROM "Tree of Manufacturing") AS public_id_routes;

-- These should both be zero.
SELECT COUNT(*) AS structural_issue_count FROM pi_kb_quality_issues_v4;
SELECT COUNT(*) AS previous_structural_issue_count FROM pi_kb_integrity_issues_v2;

-- Exactly all extracted vocabulary should have a traceable triage record.
SELECT
  (SELECT COUNT(*) FROM pi_kb_lexicon_v2) AS vocabulary_terms,
  (SELECT COUNT(*) FROM pi_kb_corpus_triage_v4) AS triaged_terms;
SELECT l.term_kind,t.classification,COUNT(*) AS terms
FROM pi_kb_lexicon_v2 l JOIN pi_kb_corpus_triage_v4 t ON t.term_id=l.term_id
GROUP BY l.term_kind,t.classification ORDER BY l.term_kind,t.classification;

-- Coverage gaps, never interpreted as verified completeness.
SELECT gap_type,COUNT(*) AS archetypes_affected
FROM pi_kb_coverage_gap_v4 GROUP BY gap_type;
SELECT * FROM pi_kb_archetype_coverage_v4
ORDER BY candidate_path_count ASC,product_archetype LIMIT 50;

-- No archetype ID may silently mix unrelated categories or names.
SELECT archetype_key,
 COUNT(DISTINCT product_category) AS category_count,
 COUNT(DISTINCT product_archetype) AS name_count
FROM pi_product_part_routes_v1
GROUP BY archetype_key
HAVING COUNT(DISTINCT product_category)>1 OR COUNT(DISTINCT product_archetype)>1;

-- Manufacturing route names must have a consistent ordered process sequence.
SELECT manufacturing_route,COUNT(DISTINCT route_steps_json) AS differing_sequences
FROM pi_product_part_routes_v1
GROUP BY manufacturing_route HAVING COUNT(DISTINCT route_steps_json)>1;

-- Claims of source-backed or reviewed engineering need independent technical evidence.
SELECT knowledge_status,COUNT(*) AS n FROM "Tree of Manufacturing"
GROUP BY knowledge_status;

-- Confirm no company links and original corpus intact.
SELECT COUNT(*) AS company_link_tables FROM sqlite_master
WHERE name='pi_company_archetype_links_v1';
SELECT COUNT(*) AS original_dictionary_records FROM company_commodity_dictionary;

PRAGMA foreign_key_check;
