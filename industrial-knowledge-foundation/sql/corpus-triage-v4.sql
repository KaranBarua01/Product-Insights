-- Rebuild / extend deterministic lexical triage; uses no external AI.
-- Run after: base KB, V4 schema, seed + normalized ID sync.
-- Preserves existing triage rows with INSERT OR IGNORE: human-reviewed entries never overwritten.
-- Company-independent: only pi_kb_lexicon_v2 aggregate strings are processed.
-- These are review *candidates*, never verified engineering facts.

INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule)
SELECT LOWER(TRIM(name)),injcode_id,entity_type,'canonical_exact'
FROM INJCODES WHERE entity_type IN ('category','archetype','part','material','route_step');

INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule)
SELECT CASE
 WHEN LOWER(name) LIKE '%y' AND SUBSTR(LOWER(name),-2,1) NOT IN ('a','e','i','o','u')
  THEN SUBSTR(LOWER(name),1,LENGTH(name)-1)||'ies'
 WHEN LOWER(name) LIKE '%ch' OR LOWER(name) LIKE '%sh' OR LOWER(name) LIKE '%x'
  THEN LOWER(name)||'es'
 ELSE LOWER(name)||'s' END,
 injcode_id,entity_type,'plural_form_unreviewed'
FROM INJCODES
WHERE entity_type IN ('archetype','part') AND LENGTH(name)>=4
  AND LOWER(name) NOT LIKE '%s' AND LOWER(name) NOT LIKE '%ss'
  AND LOWER(name) NOT LIKE '%ing';

WITH matches AS (
 SELECT l.term_id,l.term_kind,l.normalized_term,
  (SELECT a.injcode_id FROM pi_kb_lookup_aliases_v4 a
   WHERE a.alias_key=l.normalized_term AND a.entity_type IN ('archetype','part','category')
   ORDER BY CASE a.entity_type WHEN 'archetype' THEN 0 WHEN 'part' THEN 1 ELSE 2 END,
            CASE a.alias_rule WHEN 'canonical_exact' THEN 0 ELSE 1 END,a.injcode_id
   LIMIT 1) AS matched_id
 FROM pi_kb_lexicon_v2 l WHERE l.term_kind='product_phrase'
)
INSERT OR IGNORE INTO pi_kb_corpus_triage_v4(
 term_id,term_kind,classification,matched_injcode_id,strategy)
SELECT m.term_id,m.term_kind,
 CASE WHEN c.entity_type='archetype' THEN 'existing_archetype'
      WHEN c.entity_type='part' THEN 'existing_part'
      WHEN c.entity_type='category' THEN 'existing_category'
      WHEN m.normalized_term IN
       ('parts','components','assemblies','equipment','systems','services','service','products',
        'accessories','materials','solutions','industrial components','industrial equipment',
        'industrial products','precision components','machined parts','replacement parts',
        'controls','control systems','tooling','prototypes','manufacturing',
        'manufacturing services','contract manufacturing','research','engineering',
        'hardware','tools','miscellaneous','general equipment','production parts',
        'industrial supplies','business services','engineering services')
       THEN 'generic_or_ambiguous'
      WHEN m.normalized_term LIKE '% services' OR m.normalized_term LIKE '% service'
        OR m.normalized_term LIKE '% consulting' OR m.normalized_term LIKE '% contracting'
        OR m.normalized_term LIKE '% installation' OR m.normalized_term LIKE '% engineering'
        OR m.normalized_term LIKE '% maintenance' OR m.normalized_term LIKE '% repair'
        OR m.normalized_term LIKE '% fabrication' OR m.normalized_term LIKE '% machining'
        OR m.normalized_term LIKE '% training' OR m.normalized_term LIKE '% design'
        OR m.normalized_term LIKE '% integration' THEN 'service_signal'
      WHEN m.normalized_term LIKE '% pump' OR m.normalized_term LIKE '% pumps'
        OR m.normalized_term LIKE '% valve' OR m.normalized_term LIKE '% valves'
        OR m.normalized_term LIKE '% conveyor' OR m.normalized_term LIKE '% conveyors'
        OR m.normalized_term LIKE '% motor' OR m.normalized_term LIKE '% motors'
        OR m.normalized_term LIKE '% generator' OR m.normalized_term LIKE '% generators'
        OR m.normalized_term LIKE '% transformer' OR m.normalized_term LIKE '% transformers'
        OR m.normalized_term LIKE '% sensor' OR m.normalized_term LIKE '% sensors'
        OR m.normalized_term LIKE '% actuator' OR m.normalized_term LIKE '% actuators'
        OR m.normalized_term LIKE '% machine' OR m.normalized_term LIKE '% machines'
        OR m.normalized_term LIKE '% robot' OR m.normalized_term LIKE '% robots'
        OR m.normalized_term LIKE '% filter' OR m.normalized_term LIKE '% filters'
        OR m.normalized_term LIKE '% compressor' OR m.normalized_term LIKE '% compressors'
        OR m.normalized_term LIKE '% chiller' OR m.normalized_term LIKE '% chillers'
        OR m.normalized_term LIKE '% tank' OR m.normalized_term LIKE '% tanks'
        OR m.normalized_term LIKE '% vessel' OR m.normalized_term LIKE '% vessels'
        OR m.normalized_term LIKE '% meter' OR m.normalized_term LIKE '% meters'
        OR m.normalized_term LIKE '% instrument' OR m.normalized_term LIKE '% instruments'
        OR m.normalized_term LIKE '% controller' OR m.normalized_term LIKE '% controllers'
        OR m.normalized_term LIKE '% cabinet' OR m.normalized_term LIKE '% cabinets'
        OR m.normalized_term LIKE '% panel' OR m.normalized_term LIKE '% panels'
        OR m.normalized_term LIKE '% printer' OR m.normalized_term LIKE '% printers'
        OR m.normalized_term LIKE '% charger' OR m.normalized_term LIKE '% chargers'
        OR m.normalized_term LIKE '% system' OR m.normalized_term LIKE '% systems'
        OR m.normalized_term LIKE '% equipment' THEN 'product_candidate'
      ELSE 'unresolved' END,
 m.matched_id,'deterministic_canonical_alias_and_keyword_rules_v1'
FROM matches m LEFT JOIN INJCODES c ON c.injcode_id=m.matched_id;

INSERT OR IGNORE INTO pi_kb_corpus_triage_v4(
 term_id,term_kind,classification,matched_injcode_id,strategy)
SELECT l.term_id,l.term_kind,
 CASE WHEN a.injcode_id IS NOT NULL THEN 'existing_material' ELSE 'material_candidate' END,
 a.injcode_id,'deterministic_material_exact_match_v1'
FROM pi_kb_lexicon_v2 l LEFT JOIN pi_kb_lookup_aliases_v4 a
 ON a.alias_key=l.normalized_term AND a.entity_type='material' AND a.alias_rule='canonical_exact'
WHERE l.term_kind='material_token';

INSERT OR IGNORE INTO pi_kb_corpus_triage_v4(
 term_id,term_kind,classification,matched_injcode_id,strategy)
SELECT l.term_id,l.term_kind,
 CASE WHEN a.injcode_id IS NOT NULL THEN 'existing_process' ELSE 'process_candidate' END,
 a.injcode_id,'deterministic_process_exact_match_v1'
FROM pi_kb_lexicon_v2 l LEFT JOIN pi_kb_lookup_aliases_v4 a
 ON a.alias_key=l.normalized_term AND a.entity_type='route_step' AND a.alias_rule='canonical_exact'
WHERE l.term_kind='commodity_token';

-- Material or product candidate assignment is NOT evidence that a product or process is correct.
SELECT term_kind,classification,COUNT(*) n FROM pi_kb_corpus_triage_v4
 GROUP BY term_kind,classification ORDER BY term_kind,classification;
