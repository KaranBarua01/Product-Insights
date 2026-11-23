-- Product Insights Step 1 (V5) schema snapshot from D1, 2026-11-23.
-- Documentary schema snapshot; dependencies must be migrated in correct order.
-- Do not run on live D1 without backup/schema diff.
-- Company-independent product vocabulary normalization.

-- table: pi_kb_archetype_curation_v5
CREATE TABLE pi_kb_archetype_curation_v5 (
 phrase TEXT PRIMARY KEY,
 proposed_canonical_name TEXT NOT NULL,
 proposed_entity_key TEXT NOT NULL,
 proposed_category TEXT NOT NULL,
 decision TEXT NOT NULL DEFAULT 'proposed_new_archetype',
 source_term_id INTEGER REFERENCES pi_kb_lexicon_v2(term_id),
 target_injcode_id INTEGER REFERENCES INJCODES(injcode_id),
 reviewer_basis TEXT NOT NULL DEFAULT 'direct_reasoned_product_identity',
 quality_status TEXT NOT NULL DEFAULT 'provisional_taxonomy',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: pi_kb_phrase_exceptions_v5
CREATE TABLE pi_kb_phrase_exceptions_v5 (
 phrase TEXT PRIMARY KEY,
 disposition TEXT NOT NULL,
 category_name TEXT,
 rationale TEXT NOT NULL
);

-- table: pi_kb_phrase_matches_v5
CREATE TABLE pi_kb_phrase_matches_v5 (
 term_id INTEGER NOT NULL REFERENCES pi_kb_lexicon_v2(term_id),
 injcode_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
 match_rule TEXT NOT NULL,
 PRIMARY KEY(term_id,injcode_id,match_rule)
);

-- table: pi_kb_resolution_patterns_v5
CREATE TABLE pi_kb_resolution_patterns_v5 (
 priority INTEGER NOT NULL UNIQUE,
 rule_key TEXT PRIMARY KEY,
 mode TEXT NOT NULL CHECK(mode IN('suffix','prefix','contains','exact')),
 pattern TEXT NOT NULL,
 disposition TEXT NOT NULL,
 category_name TEXT,
 rationale TEXT NOT NULL
);

-- table: pi_kb_resolution_rule_hits_v5
CREATE TABLE pi_kb_resolution_rule_hits_v5 (
 term_id INTEGER NOT NULL REFERENCES pi_kb_lexicon_v2(term_id),
 rule_key TEXT NOT NULL REFERENCES pi_kb_resolution_patterns_v5(rule_key),
 PRIMARY KEY(term_id,rule_key)
);

-- table: pi_kb_taxonomy_issues_v5
CREATE TABLE pi_kb_taxonomy_issues_v5 (
 issue_key TEXT PRIMARY KEY,
 issue_type TEXT NOT NULL,
 reference TEXT NOT NULL,
 detail TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table: pi_kb_term_resolution_v5
CREATE TABLE pi_kb_term_resolution_v5 (
 term_id INTEGER PRIMARY KEY REFERENCES pi_kb_lexicon_v2(term_id),
 normalized_surface TEXT NOT NULL,
 singular_surface TEXT NOT NULL,
 modifier_stripped_surface TEXT,
 disposition TEXT NOT NULL DEFAULT 'needs_context',
 matched_injcode_id INTEGER REFERENCES INJCODES(injcode_id),
 suggested_category_id INTEGER REFERENCES INJCODES(injcode_id),
 canonical_candidate TEXT,
 decision_basis TEXT NOT NULL DEFAULT 'awaiting_triage_v5',
 confidence_tier TEXT NOT NULL DEFAULT 'none',
 review_state TEXT NOT NULL DEFAULT 'pending',
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- view: pi_kb_match_rollup_v5
CREATE VIEW pi_kb_match_rollup_v5 AS
SELECT m.term_id,
 COUNT(DISTINCT m.injcode_id) AS candidate_id_count,
 MIN(m.injcode_id) AS single_id,
 SUM(m.match_rule LIKE 'exact_surface:%') AS exact_surface_hits,
 SUM(m.match_rule LIKE 'singular_surface:%') AS singular_surface_hits
FROM pi_kb_phrase_matches_v5 m
WHERE m.match_rule NOT LIKE 'modifier_stripped_candidate:%'
GROUP BY m.term_id;

-- view: pi_kb_resolution_rule_winner_v5
CREATE VIEW pi_kb_resolution_rule_winner_v5 AS
SELECT h.term_id,p.priority,p.rule_key,p.disposition,p.category_name,p.rationale
FROM pi_kb_resolution_rule_hits_v5 h
JOIN pi_kb_resolution_patterns_v5 p ON p.rule_key=h.rule_key
WHERE p.priority=(
 SELECT MIN(p2.priority)
 FROM pi_kb_resolution_rule_hits_v5 h2
 JOIN pi_kb_resolution_patterns_v5 p2 ON p2.rule_key=h2.rule_key
 WHERE h2.term_id=h.term_id);

-- view: pi_kb_taxonomy_ambiguous_id_matches_v5
CREATE VIEW pi_kb_taxonomy_ambiguous_id_matches_v5 AS
SELECT r.term_id,l.normalized_term,l.term_kind,l.occurrence_count,
       COUNT(DISTINCT m.injcode_id) AS matching_ids,
       GROUP_CONCAT(DISTINCT m.injcode_id) AS possible_injcodes
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
JOIN pi_kb_phrase_matches_v5 m ON m.term_id=r.term_id
WHERE r.disposition IN('ambiguous_id_match_review','ambiguous_scope_review','cross_type_mismatch_review')
GROUP BY r.term_id HAVING matching_ids>1;

-- view: pi_kb_taxonomy_archetypes_v5
CREATE VIEW pi_kb_taxonomy_archetypes_v5 AS
SELECT n.entity_id AS injcode_id,n.entity_key,n.canonical_name,
       cat.canonical_name AS product_category,n.record_status,
       COUNT(DISTINCT tc.child_id) AS configuration_count,
       CASE WHEN COUNT(DISTINCT tc.child_id)=0 THEN 'taxonomy_only_needs_step_2'
            ELSE 'manufacturing_mapping_exists' END AS coverage_status
FROM pi_kb_names_v1 n
LEFT JOIN pi_kb_hierarchy_edges_v1 ca ON ca.child_id=n.entity_id AND ca.relation='CATEGORY_ARCHETYPE'
LEFT JOIN pi_kb_names_v1 cat ON cat.entity_id=ca.parent_id AND cat.entity_type='category'
LEFT JOIN pi_kb_hierarchy_edges_v1 tc ON tc.parent_id=n.entity_id AND tc.relation='ARCHETYPE_CONFIGURATION'
WHERE n.entity_type='archetype'
GROUP BY n.entity_id;

-- view: pi_kb_taxonomy_integrity_issues_extra_v5
CREATE VIEW pi_kb_taxonomy_integrity_issues_extra_v5 AS
SELECT 'curation_alias_missing_INJCODE' AS issue_type,c.phrase AS reference
FROM pi_kb_archetype_curation_v5 c LEFT JOIN INJCODES n ON n.injcode_id=c.target_injcode_id
WHERE c.decision='alias_existing' AND n.injcode_id IS NULL
UNION ALL
SELECT 'curation_quarantine_with_mapped_target',c.phrase
FROM pi_kb_archetype_curation_v5 c
WHERE c.decision='scope_review' AND c.target_injcode_id IS NOT NULL
UNION ALL
SELECT 'untriaged_term',CAST(l.term_id AS TEXT)
FROM pi_kb_lexicon_v2 l LEFT JOIN pi_kb_term_resolution_v5 r ON r.term_id=l.term_id
WHERE r.term_id IS NULL
UNION ALL
SELECT 'unclassified_disposition',CAST(r.term_id AS TEXT)
FROM pi_kb_term_resolution_v5 r WHERE r.disposition='needs_context';

-- view: pi_kb_taxonomy_integrity_issues_v5
CREATE VIEW pi_kb_taxonomy_integrity_issues_v5 AS
SELECT 'unresolved_foreign_ID' AS issue_type,CAST(r.term_id AS TEXT) AS reference
FROM pi_kb_term_resolution_v5 r LEFT JOIN INJCODES n ON n.injcode_id=r.matched_injcode_id
WHERE r.disposition LIKE 'canonical_%' AND r.matched_injcode_id IS NOT NULL AND n.injcode_id IS NULL
UNION ALL
SELECT 'canonical_archetype_wrong_entity_type',CAST(r.term_id AS TEXT)
FROM pi_kb_term_resolution_v5 r JOIN INJCODES n ON n.injcode_id=r.matched_injcode_id
WHERE r.disposition='canonical_archetype' AND n.entity_type<>'archetype'
UNION ALL
SELECT 'archetype_missing_category',CAST(t.injcode_id AS TEXT)
FROM pi_kb_taxonomy_archetypes_v5 t WHERE t.product_category IS NULL
UNION ALL
SELECT 'curation_new_missing_INJCODE',c.phrase
FROM pi_kb_archetype_curation_v5 c LEFT JOIN INJCODES n ON n.injcode_id=c.target_injcode_id
WHERE c.decision='new_archetype' AND n.injcode_id IS NULL;

-- view: pi_kb_taxonomy_review_backlog_v5
CREATE VIEW pi_kb_taxonomy_review_backlog_v5 AS
SELECT l.term_id,l.normalized_term,l.occurrence_count,l.term_kind,
r.disposition,r.normalized_surface,r.singular_surface,
r.suggested_category_id,cat.name AS suggested_category,
r.canonical_candidate,r.decision_basis,r.review_state,
CASE
 WHEN r.disposition IN ('ambiguous_id_match_review','ambiguous_scope_review') THEN l.occurrence_count*8
 WHEN r.disposition IN ('specific_product_candidate_review','system_level_product_review') THEN l.occurrence_count*5
 WHEN r.disposition IN ('context_required_review','alias_candidate_review') THEN l.occurrence_count*3
 ELSE l.occurrence_count END AS review_priority
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
LEFT JOIN INJCODES cat ON cat.injcode_id=r.suggested_category_id
WHERE r.review_state='pending';

-- view: pi_kb_taxonomy_review_summary_v5
CREATE VIEW pi_kb_taxonomy_review_summary_v5 AS
SELECT r.disposition,r.review_state,COUNT(*) AS phrases,
       SUM(l.occurrence_count) AS occurrences
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
WHERE l.term_kind='product_phrase'
GROUP BY r.disposition,r.review_state;

-- view: pi_kb_taxonomy_step1_gate_v5
CREATE VIEW pi_kb_taxonomy_step1_gate_v5 AS
SELECT
 CASE
 WHEN (SELECT COUNT(*) FROM pi_kb_taxonomy_integrity_issues_v5)
     +(SELECT COUNT(*) FROM pi_kb_taxonomy_integrity_issues_extra_v5)=0
 THEN 'PASS' ELSE 'FAIL' END AS structural_gate,
 CASE
 WHEN (SELECT COUNT(*) FROM pi_kb_taxonomy_review_backlog_v5 WHERE term_kind='product_phrase')=0
 THEN 'COMPLETE' ELSE 'REVIEW_PENDING' END AS semantic_completion_gate,
 (SELECT COUNT(*) FROM pi_kb_taxonomy_integrity_issues_v5)
     +(SELECT COUNT(*) FROM pi_kb_taxonomy_integrity_issues_extra_v5) AS structural_issue_count,
 (SELECT COUNT(*) FROM pi_kb_taxonomy_review_backlog_v5 WHERE term_kind='product_phrase') AS product_phrase_review_backlog;

-- view: pi_kb_taxonomy_step1_scorecard_v5
CREATE VIEW pi_kb_taxonomy_step1_scorecard_v5 AS
SELECT
 (SELECT COUNT(*) FROM pi_kb_lexicon_v2 WHERE term_kind='product_phrase') AS total_product_phrases,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 r JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
  WHERE l.term_kind='product_phrase' AND r.disposition='canonical_archetype') AS matched_product_phrases,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 r JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
  WHERE l.term_kind='product_phrase' AND r.review_state='pending') AS product_phrases_needing_semantic_review,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 r JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id
  WHERE l.term_kind='product_phrase' AND r.review_state<>'pending') AS product_phrases_screened_or_matched,
 (SELECT COUNT(*) FROM INJCODES WHERE entity_type='archetype') AS archetype_id_count,
 (SELECT COUNT(*) FROM INJCODES WHERE entity_type='archetype' AND record_status='provisional_corpus_taxonomy_v5') AS new_provisional_archetypes,
 (SELECT COUNT(*) FROM pi_kb_taxonomy_issues_v5 WHERE status='open') AS unresolved_structural_taxonomy_issues,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 WHERE disposition='needs_context') AS unclassified_strings;

-- view: pi_kb_taxonomy_summary_v5
CREATE VIEW pi_kb_taxonomy_summary_v5 AS
SELECT
 (SELECT COUNT(*) FROM pi_kb_lexicon_v2) vocabulary_terms,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5) classified_terms,
 (SELECT COUNT(*) FROM pi_kb_lexicon_v2 WHERE term_kind='product_phrase') product_phrases,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 WHERE disposition='canonical_archetype'
    AND term_id IN (SELECT term_id FROM pi_kb_lexicon_v2 WHERE term_kind='product_phrase'))
    resolved_product_phrases,
 (SELECT COUNT(*) FROM INJCODES WHERE entity_type='archetype') canonical_archetypes,
 (SELECT COUNT(*) FROM INJCODES WHERE entity_type='archetype' AND record_status='provisional_corpus_taxonomy_v5') new_provisional_archetypes,
 (SELECT COUNT(DISTINCT product_archetype_id) FROM "Tree of Manufacturing") mapped_archetypes,
 (SELECT COUNT(*) FROM pi_kb_archetype_curation_v5 WHERE decision='scope_review') explicitly_quarantined_phrases,
 (SELECT COUNT(*) FROM pi_kb_term_resolution_v5 WHERE review_state='pending') awaiting_context_or_review,
 (SELECT COUNT(*) FROM pi_kb_taxonomy_issues_v5 WHERE status='open') open_taxonomy_issues;
