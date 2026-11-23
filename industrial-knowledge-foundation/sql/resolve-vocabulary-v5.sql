-- Product Insights V5 -- deterministic lexical resolution, no external AI.
-- Run after V5 schema and tools/build-taxonomy-catalog-v5.mjs-generated SQL.
-- Uses aggregate vocabulary and INJCODES; never creates company-to-product links.
-- Rerun against a reviewed development D1 first. Preserve manual curation in V5 table.

INSERT OR IGNORE INTO pi_kb_term_resolution_v5 (
 term_id,normalized_surface,singular_surface,modifier_stripped_surface,
 disposition,matched_injcode_id,suggested_category_id,canonical_candidate,
 decision_basis,confidence_tier,review_state)
SELECT l.term_id,l.normalized_term,l.normalized_term,NULL,
 CASE l.term_kind WHEN 'product_phrase' THEN 'needs_context'
 WHEN 'material_token' THEN 'material_candidate_review' ELSE 'process_candidate_review' END,
 t.matched_injcode_id,t.suggested_category_id,NULL,'v5_corpus_initialization','none','pending'
FROM pi_kb_lexicon_v2 l LEFT JOIN pi_kb_corpus_triage_v4 t ON t.term_id=l.term_id;

-- Normalize common typography while keeping the original extracted phrase immutable.
UPDATE pi_kb_term_resolution_v5
SET normalized_surface=TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
 LOWER(normalized_surface),char(9),' '),'-',' '),'&',' and '),'/',' '),char(10),' '),'  ',' '));
UPDATE pi_kb_term_resolution_v5
SET normalized_surface=TRIM(REPLACE(REPLACE(normalized_surface,'  ',' '),'  ',' '));
UPDATE pi_kb_term_resolution_v5
SET singular_surface=CASE
 WHEN LENGTH(normalized_surface)<5 THEN normalized_surface
 WHEN normalized_surface LIKE '%ies' AND normalized_surface NOT LIKE '%series'
  THEN SUBSTR(normalized_surface,1,LENGTH(normalized_surface)-3)||'y'
 WHEN normalized_surface LIKE '%sses' OR normalized_surface LIKE '%ches'
   OR normalized_surface LIKE '%shes' OR normalized_surface LIKE '%xes'
  THEN SUBSTR(normalized_surface,1,LENGTH(normalized_surface)-2)
 WHEN normalized_surface LIKE '%s' AND normalized_surface NOT LIKE '%ss'
   AND normalized_surface NOT LIKE '%us' AND normalized_surface NOT LIKE '%is'
   AND normalized_surface NOT LIKE '%ics'
  THEN SUBSTR(normalized_surface,1,LENGTH(normalized_surface)-1)
 ELSE normalized_surface END;
UPDATE pi_kb_term_resolution_v5
SET modifier_stripped_surface=CASE
 WHEN singular_surface LIKE 'industrial %' THEN SUBSTR(singular_surface,12)
 WHEN singular_surface LIKE 'commercial %' THEN SUBSTR(singular_surface,12)
 WHEN singular_surface LIKE 'custom %' THEN SUBSTR(singular_surface,8)
 WHEN singular_surface LIKE 'precision %' THEN SUBSTR(singular_surface,11)
 ELSE NULL END;

-- Build canonical and provisional plural surfaces; do not invent synonyms by embedding similarity.
INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule)
SELECT LOWER(TRIM(name)),injcode_id,entity_type,'canonical_exact'
FROM INJCODES WHERE entity_type IN('archetype','part','category','material','route_step');
INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule)
SELECT CASE
 WHEN LOWER(name) LIKE '%y' AND SUBSTR(LOWER(name),-2,1) NOT IN ('a','e','i','o','u')
 THEN SUBSTR(LOWER(name),1,LENGTH(name)-1)||'ies'
 WHEN LOWER(name) LIKE '%ch' OR LOWER(name) LIKE '%sh' OR LOWER(name) LIKE '%x'
 THEN LOWER(name)||'es' ELSE LOWER(name)||'s' END,
 injcode_id,entity_type,'plural_form_unreviewed'
FROM INJCODES WHERE entity_type IN('archetype','part')
AND LENGTH(name)>=4 AND LOWER(name) NOT LIKE '%s'
AND LOWER(name) NOT LIKE '%ss' AND LOWER(name) NOT LIKE '%ing';
INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule)
SELECT phrase,target_injcode_id,'archetype',
CASE WHEN decision='new_archetype' THEN 'v5_provisional_taxonomy_source_phrase'
 ELSE 'v5_curated_existing_alias' END
FROM pi_kb_archetype_curation_v5
WHERE decision IN('new_archetype','alias_existing') AND target_injcode_id IS NOT NULL;

-- Explicit matching candidates; potential collisions are retained for review.
INSERT OR IGNORE INTO pi_kb_phrase_matches_v5(term_id,injcode_id,match_rule)
SELECT r.term_id,a.injcode_id,'exact_surface:'||a.alias_rule
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lookup_aliases_v4 a ON a.alias_key=r.normalized_surface
WHERE a.entity_type IN('archetype','part','category','material','route_step');
INSERT OR IGNORE INTO pi_kb_phrase_matches_v5(term_id,injcode_id,match_rule)
SELECT r.term_id,a.injcode_id,'singular_surface:'||a.alias_rule
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lookup_aliases_v4 a ON a.alias_key=r.singular_surface
WHERE a.entity_type IN('archetype','part','category','material','route_step')
AND r.singular_surface<>r.normalized_surface;
INSERT OR IGNORE INTO pi_kb_phrase_matches_v5(term_id,injcode_id,match_rule)
SELECT r.term_id,a.injcode_id,'modifier_stripped_candidate:'||a.alias_rule
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lookup_aliases_v4 a ON a.alias_key=r.modifier_stripped_surface
WHERE a.entity_type='archetype' AND r.modifier_stripped_surface IS NOT NULL;

-- Curation is highest priority; do not force ambiguously scoped terms into an ID.
UPDATE pi_kb_term_resolution_v5
SET disposition='canonical_archetype',
 matched_injcode_id=(SELECT target_injcode_id FROM pi_kb_archetype_curation_v5 c
  WHERE c.source_term_id=pi_kb_term_resolution_v5.term_id LIMIT 1),
 suggested_category_id=(SELECT n.injcode_id FROM pi_kb_archetype_curation_v5 c
  JOIN INJCODES n ON n.entity_type='category' AND n.name=c.proposed_category
  WHERE c.source_term_id=pi_kb_term_resolution_v5.term_id LIMIT 1),
 canonical_candidate=(SELECT n.name FROM pi_kb_archetype_curation_v5 c
  JOIN INJCODES n ON n.injcode_id=c.target_injcode_id
  WHERE c.source_term_id=pi_kb_term_resolution_v5.term_id LIMIT 1),
 decision_basis='v5_product_identity_curated_from_source_phrase',
 confidence_tier='curated',review_state='provisional_taxonomy'
WHERE term_id IN(SELECT source_term_id FROM pi_kb_archetype_curation_v5
 WHERE decision IN('new_archetype','alias_existing') AND target_injcode_id IS NOT NULL);
UPDATE pi_kb_term_resolution_v5
SET disposition='ambiguous_scope_review',matched_injcode_id=NULL,
 canonical_candidate=NULL,suggested_category_id=NULL,
 decision_basis='v5_scope_conflict_no_forced_equivalence',
 confidence_tier='none',review_state='pending'
WHERE term_id IN(SELECT source_term_id FROM pi_kb_archetype_curation_v5
 WHERE decision='scope_review');

UPDATE pi_kb_term_resolution_v5
SET disposition=(SELECT e.disposition FROM pi_kb_phrase_exceptions_v5 e
 WHERE e.phrase=pi_kb_term_resolution_v5.normalized_surface LIMIT 1),
 matched_injcode_id=NULL,canonical_candidate=NULL,
 suggested_category_id=(SELECT n.injcode_id FROM pi_kb_phrase_exceptions_v5 e
 JOIN INJCODES n ON n.entity_type='category' AND n.name=e.category_name
 WHERE e.phrase=pi_kb_term_resolution_v5.normalized_surface LIMIT 1),
 decision_basis='explicit_phrase_exception_v5',confidence_tier='curated',
 review_state='pending'
WHERE disposition='needs_context'
AND normalized_surface IN(SELECT phrase FROM pi_kb_phrase_exceptions_v5);

-- A unique matching ID is a provisional lexical match, not engineering verification.
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition=CASE n.entity_type
 WHEN 'archetype' THEN 'canonical_archetype'
 WHEN 'part' THEN 'canonical_part'
 WHEN 'category' THEN 'canonical_category'
 WHEN 'material' THEN 'canonical_material'
 WHEN 'route_step' THEN 'canonical_manufacturing_process'
 ELSE 'needs_context' END,
 matched_injcode_id=m.single_id,canonical_candidate=n.name,
 decision_basis=CASE WHEN m.exact_surface_hits>0
 THEN 'existing_canonical_or_registered_alias'
 ELSE 'singularized_surface_unique_match' END,
 confidence_tier=CASE WHEN m.exact_surface_hits>0 THEN 'exact_or_alias' ELSE 'morphological' END,
 review_state='provisional_auto_match'
FROM pi_kb_match_rollup_v5 m JOIN INJCODES n ON n.injcode_id=m.single_id
WHERE r.term_id=m.term_id AND m.candidate_id_count=1
AND r.disposition IN('needs_context','material_candidate_review','process_candidate_review');
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition='ambiguous_id_match_review',matched_injcode_id=NULL,
 canonical_candidate=NULL,
 decision_basis='multiple_distinct_INJCODES_candidates_no_forced_merge',
 confidence_tier='none',review_state='pending'
FROM pi_kb_match_rollup_v5 m
WHERE r.term_id=m.term_id AND m.candidate_id_count>1
AND r.disposition IN('needs_context','material_candidate_review','process_candidate_review');
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition='alias_candidate_review',matched_injcode_id=NULL,
 canonical_candidate=NULL,decision_basis='modifier_removal_requires_review',
 confidence_tier='weak',review_state='pending'
WHERE r.disposition='needs_context'
AND EXISTS(SELECT 1 FROM pi_kb_phrase_matches_v5 p
 WHERE p.term_id=r.term_id AND p.match_rule LIKE 'modifier_stripped_candidate:%');

-- Apply rules only to terms not safely linked to canonical IDs.
INSERT OR IGNORE INTO pi_kb_resolution_rule_hits_v5(term_id,rule_key)
SELECT r.term_id,p.rule_key
FROM pi_kb_term_resolution_v5 r
JOIN pi_kb_lexicon_v2 l ON l.term_id=r.term_id AND l.term_kind='product_phrase'
CROSS JOIN pi_kb_resolution_patterns_v5 p
WHERE r.disposition='needs_context' AND (
 (p.mode='suffix' AND r.normalized_surface LIKE '% '||p.pattern)
 OR (p.mode='exact' AND r.normalized_surface=p.pattern)
 OR (p.mode='prefix' AND r.normalized_surface LIKE p.pattern||' %')
 OR (p.mode='contains' AND r.normalized_surface LIKE '%'||p.pattern||'%'));
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition=w.disposition,matched_injcode_id=NULL,
 suggested_category_id=cat.injcode_id,canonical_candidate=NULL,
 decision_basis='deterministic_pattern:'||w.rule_key,
 confidence_tier='rule',
 review_state=CASE
 WHEN w.disposition IN('nonphysical_service','nonindustrial_domain','extraction_failure')
 THEN 'screened_non_archetype'
 WHEN w.disposition IN('manufactured_component_family_review','generic_part_family')
 THEN 'routed_to_part_review'
 WHEN w.disposition='manufacturing_process_or_service_review' THEN 'routed_to_process_review'
 ELSE 'pending' END
FROM pi_kb_resolution_rule_winner_v5 w
LEFT JOIN INJCODES cat ON cat.entity_type='category' AND cat.name=w.category_name
WHERE r.term_id=w.term_id AND r.disposition='needs_context';

UPDATE pi_kb_term_resolution_v5 AS r
SET disposition=CASE t.classification
 WHEN 'product_candidate' THEN 'specific_product_candidate_review'
 WHEN 'service_signal' THEN 'service_candidate_review'
 WHEN 'generic_or_ambiguous' THEN 'broad_or_generic_review'
 WHEN 'existing_archetype' THEN 'legacy_match_requires_review'
 WHEN 'existing_part' THEN 'legacy_match_requires_review'
 WHEN 'existing_category' THEN 'legacy_match_requires_review'
 ELSE 'context_required_review' END,
 matched_injcode_id=NULL,canonical_candidate=NULL,
 decision_basis='v5_legacy_triage_fallback_no_forced_equivalence',
 confidence_tier='weak',review_state='pending'
FROM pi_kb_corpus_triage_v4 t
WHERE r.term_id=t.term_id AND r.disposition='needs_context';

UPDATE pi_kb_term_resolution_v5
SET disposition='context_required_review',matched_injcode_id=NULL,
 canonical_candidate=NULL,decision_basis='no_deterministic_match',
 confidence_tier='none',review_state='pending'
WHERE disposition='needs_context';

-- Corpus field types can be noisy. Never silently equate material and process names.
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition='cross_type_mismatch_review',matched_injcode_id=NULL,
 canonical_candidate=NULL,decision_basis='lexicon_kind_ID_type_conflict',
 confidence_tier='none',review_state='pending'
FROM pi_kb_lexicon_v2 l, INJCODES n
WHERE l.term_id=r.term_id AND n.injcode_id=r.matched_injcode_id
AND ((l.term_kind='material_token' AND n.entity_type<>'material')
 OR (l.term_kind='commodity_token' AND n.entity_type<>'route_step'));

UPDATE pi_kb_term_resolution_v5 AS r
SET suggested_category_id=(SELECT e.parent_id FROM pi_kb_hierarchy_edges_v1 e
 WHERE e.child_id=r.matched_injcode_id AND e.relation='CATEGORY_ARCHETYPE'
 ORDER BY e.parent_id LIMIT 1)
WHERE r.disposition='canonical_archetype' AND r.matched_injcode_id IS NOT NULL
AND EXISTS(SELECT 1 FROM pi_kb_hierarchy_edges_v1 e
 WHERE e.child_id=r.matched_injcode_id AND e.relation='CATEGORY_ARCHETYPE');

-- Honest scoping: broad sectors are not new archetypes; material/process backlogs
-- belong to Step 4; all specific product candidates remain pending review.
UPDATE pi_kb_term_resolution_v5
SET review_state='screened_broad_family_not_unique_archetype'
WHERE disposition='broad_product_family' AND review_state='pending';
UPDATE pi_kb_term_resolution_v5
SET review_state='deferred_material_normalization_step4'
WHERE disposition='material_candidate_review' AND review_state='pending';
UPDATE pi_kb_term_resolution_v5
SET review_state='deferred_process_normalization_step4'
WHERE disposition='process_candidate_review' AND review_state='pending';
UPDATE pi_kb_term_resolution_v5
SET disposition='ambiguous_single_term_review',
 decision_basis='single_token_cannot_identify_unique_archetype',
 confidence_tier='none',review_state='pending'
WHERE disposition='context_required_review' AND normalized_surface NOT LIKE '% %';

-- Reapply curated single-word/family exceptions after fallback, but not after
-- a confirmed canonical entity/alias decision.
UPDATE pi_kb_term_resolution_v5 AS r
SET disposition=e.disposition,matched_injcode_id=NULL,canonical_candidate=NULL,
 suggested_category_id=cat.injcode_id,
 decision_basis='manual_taxonomy_ambiguity_screen:'||e.rationale,
 confidence_tier='curated',
 review_state=CASE
 WHEN e.disposition='broad_product_family' THEN 'screened_broad_family_not_unique_archetype'
 WHEN e.disposition IN('generic_part_family','manufactured_component_family_review')
 THEN 'routed_to_part_review'
 WHEN e.disposition='manufacturing_process_or_service_review' THEN 'routed_to_process_review'
 WHEN e.disposition='material_or_commodity_phrase' THEN 'deferred_material_normalization_step4'
 WHEN e.disposition IN('nonindustrial_domain','nonphysical_service','extraction_failure')
 THEN 'screened_non_archetype' ELSE 'pending' END
FROM pi_kb_phrase_exceptions_v5 e
LEFT JOIN INJCODES cat ON cat.entity_type='category' AND cat.name=e.category_name
WHERE r.normalized_surface=e.phrase AND r.review_state='pending'
AND r.disposition IN('ambiguous_single_term_review','context_required_review',
 'specific_product_candidate_review','system_level_product_review',
 'broad_product_family','generic_part_family');

-- Existing duplicate label is a review issue, not a reason to delete mapped IDs.
INSERT OR IGNORE INTO pi_kb_taxonomy_issues_v5(issue_key,issue_type,reference,detail,status)
SELECT 'duplicate_archetype_label:'||LOWER(name),'duplicate_archetype_label',LOWER(name),
 'Multiple numeric archetype IDs share a name; reconcile mapping references before merge','open'
FROM INJCODES WHERE entity_type='archetype' GROUP BY LOWER(name) HAVING COUNT(*)>1;

SELECT * FROM pi_kb_taxonomy_step1_gate_v5;
SELECT * FROM pi_kb_taxonomy_step1_scorecard_v5;
