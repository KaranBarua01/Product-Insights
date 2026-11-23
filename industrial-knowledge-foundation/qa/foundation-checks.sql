-- Product Insights V2 Industrial Knowledge Foundation: read-only smoke tests.
-- Never create company->archetype relationships here.
SELECT * FROM pi_kb_quality_summary_v2;
SELECT issue, reference FROM pi_kb_integrity_issues_v2 LIMIT 100;
SELECT (SELECT COUNT(*) FROM pi_product_part_routes_v1) AS source_templates,
       (SELECT COUNT(*) FROM pi_kb_part_route_map_v1) AS id_mappings,
       (SELECT COUNT(*) FROM pi_kb_product_tree_v1) AS resolved_paths;
SELECT archetype_key, COUNT(DISTINCT product_category) category_count
 FROM pi_product_part_routes_v1
 GROUP BY archetype_key HAVING COUNT(DISTINCT product_category)>1;
SELECT entity_type,COUNT(*) unique_concepts
 FROM pi_kb_names_v1 GROUP BY entity_type ORDER BY entity_type;
SELECT term_kind,COUNT(*) vocabulary_strings,
       SUM(occurrence_count) total_appearances
 FROM pi_kb_lexicon_v2 GROUP BY term_kind;
SELECT proposal_type,review_status,COUNT(*) n
 FROM pi_kb_review_queue_v2 GROUP BY proposal_type,review_status;
SELECT knowledge_status,COUNT(*) n FROM pi_kb_part_route_map_v1
 GROUP BY knowledge_status;
SELECT route_id,COUNT(*) step_count FROM pi_kb_route_step_map_v1
 GROUP BY route_id ORDER BY step_count DESC LIMIT 10;
PRAGMA foreign_key_check;
