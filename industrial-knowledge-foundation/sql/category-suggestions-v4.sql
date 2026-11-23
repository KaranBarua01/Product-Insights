-- Company-independent category *suggestions* for triaged product phrases.
-- These are lexical heuristics only; category suggestions require review.
-- Re-run after lexical triage and INJCODES/Tree sync.
UPDATE pi_kb_corpus_triage_v4
SET suggested_category_id=matched_injcode_id
WHERE term_kind='product_phrase' AND classification='existing_category';

UPDATE pi_kb_corpus_triage_v4
SET suggested_category_id=(
 SELECT MIN(product_category_id) FROM "Tree of Manufacturing" t
 WHERE t.product_archetype_id=pi_kb_corpus_triage_v4.matched_injcode_id)
WHERE term_kind='product_phrase' AND classification='existing_archetype';

UPDATE pi_kb_corpus_triage_v4
SET suggested_category_id=(
 SELECT cat.injcode_id
 FROM pi_kb_lexicon_v2 l
 JOIN INJCODES cat ON cat.entity_type='category'
 AND cat.name=CASE
 WHEN l.normalized_term LIKE '%pump' OR l.normalized_term LIKE '%pumps'
   OR l.normalized_term LIKE '%valve' OR l.normalized_term LIKE '%valves'
 THEN 'Fluid Handling'
 WHEN l.normalized_term LIKE '%conveyor' OR l.normalized_term LIKE '%conveyors'
   OR l.normalized_term LIKE '%elevator' OR l.normalized_term LIKE '%elevators'
 THEN 'Material Handling'
 WHEN l.normalized_term LIKE '%sensor' OR l.normalized_term LIKE '%sensors'
   OR l.normalized_term LIKE '%meter' OR l.normalized_term LIKE '%meters'
   OR l.normalized_term LIKE '%transmitter' OR l.normalized_term LIKE '%transmitters'
 THEN 'Instrumentation'
 WHEN l.normalized_term LIKE '%controller' OR l.normalized_term LIKE '%controllers'
   OR l.normalized_term LIKE '%control panel' OR l.normalized_term LIKE '%control panels'
 THEN 'Industrial Controls'
 WHEN l.normalized_term LIKE '%motor' OR l.normalized_term LIKE '%motors'
   OR l.normalized_term LIKE '%gearbox' OR l.normalized_term LIKE '%gearboxes'
 THEN 'Motion & Power Transmission'
 WHEN l.normalized_term LIKE '%robot' OR l.normalized_term LIKE '%robots'
 THEN 'Robotics & Automation'
 WHEN l.normalized_term LIKE '%generator' OR l.normalized_term LIKE '%generators'
   OR l.normalized_term LIKE '%transformer' OR l.normalized_term LIKE '%transformers'
   OR l.normalized_term LIKE '%charger' OR l.normalized_term LIKE '%chargers'
 THEN 'Electrical Power'
 WHEN l.normalized_term LIKE '%battery' OR l.normalized_term LIKE '%batteries'
 THEN 'Energy Storage'
 WHEN l.normalized_term LIKE '%filter' OR l.normalized_term LIKE '%filters'
 THEN 'Filtration'
 WHEN l.normalized_term LIKE '%compressor' OR l.normalized_term LIKE '%compressors'
 THEN 'Pneumatics'
 WHEN l.normalized_term LIKE '%chiller' OR l.normalized_term LIKE '%chillers'
 THEN 'HVAC'
 ELSE NULL END
 WHERE l.term_id=pi_kb_corpus_triage_v4.term_id)
WHERE term_kind='product_phrase' AND classification='product_candidate';

SELECT cat.name AS suggested_category,COUNT(*) AS candidate_phrases
FROM pi_kb_corpus_triage_v4 t JOIN INJCODES cat ON cat.injcode_id=t.suggested_category_id
WHERE t.classification='product_candidate'
GROUP BY cat.name ORDER BY candidate_phrases DESC;
