-- Product Insights Step 1 (V5) schema snapshot from D1, 2026-11-23.
-- Historical reference and development migration aid; dependency order must be reviewed.
-- Do not run against live D1 without backup and schema diff.
-- No company/product linking; terms are mined in aggregate.

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
