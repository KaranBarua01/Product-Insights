-- D1 schema snapshot: public tables and V4 processing objects, 2026-11-23.
-- Documentary schema; not a tested standalone migration; view dependencies require base KB first.
-- Company-independent. Never import into live D1 without backup and review.

-- table: INJCODES
CREATE TABLE INJCODES (
  injcode_id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN
    ('category','archetype','configuration','assembly','part','material','route','route_step')),
  entity_key TEXT NOT NULL,
  name TEXT NOT NULL,
  record_status TEXT NOT NULL DEFAULT 'candidate_from_seed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type,entity_key)
);

-- table: Tree of Manufacturing
CREATE TABLE "Tree of Manufacturing" (
  mapping_id INTEGER PRIMARY KEY,
  product_category_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  product_archetype_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  product_configuration_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  assembly_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  part_type_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  material_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  manufacturing_route_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  knowledge_status TEXT NOT NULL DEFAULT 'engineering_hypothesis'
    CHECK(knowledge_status IN ('engineering_hypothesis','source_supported','reviewed','rejected')),
  engineering_conditions TEXT NOT NULL DEFAULT '',
  original_seed_route_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_category_id,product_archetype_id,product_configuration_id,
         assembly_id,part_type_id,material_id,manufacturing_route_id)
);

-- table: pi_kb_corpus_triage_v4
CREATE TABLE pi_kb_corpus_triage_v4 (
 term_id INTEGER PRIMARY KEY REFERENCES pi_kb_lexicon_v2(term_id),
 term_kind TEXT NOT NULL,
 classification TEXT NOT NULL CHECK(classification IN (
  'existing_archetype','existing_part','existing_material','existing_category',
  'existing_process','service_signal','generic_or_ambiguous',
  'product_candidate','material_candidate','process_candidate','unresolved'
 )),
 matched_injcode_id INTEGER REFERENCES INJCODES(injcode_id),
 strategy TEXT NOT NULL DEFAULT 'deterministic_rules_v1',
 review_state TEXT NOT NULL DEFAULT 'needs_review'
   CHECK(review_state IN('needs_review','reviewed_accepted','reviewed_rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, suggested_category_id INTEGER REFERENCES INJCODES(injcode_id));

-- table: pi_kb_lookup_aliases_v4
CREATE TABLE pi_kb_lookup_aliases_v4 (
 alias_key TEXT NOT NULL,
 injcode_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
 entity_type TEXT NOT NULL,
 alias_rule TEXT NOT NULL,
 PRIMARY KEY(alias_key,injcode_id,alias_rule)
);

-- table: pi_kb_material_route_rules_v4
CREATE TABLE pi_kb_material_route_rules_v4 (
  rule_id TEXT PRIMARY KEY,
  part_name_like TEXT NOT NULL,
  source_material TEXT NOT NULL,
  product_category_filter TEXT,
  alternative_material TEXT NOT NULL,
  alternative_route TEXT NOT NULL,
  route_steps_json TEXT NOT NULL CHECK(json_valid(route_steps_json)),
  engineering_conditions TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'engineering_hypothesis',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- index: idx_kb_lookup_alias_key_v4
CREATE INDEX idx_kb_lookup_alias_key_v4 ON pi_kb_lookup_aliases_v4(alias_key);

-- index: idx_kb_triage_cat_v4
CREATE INDEX idx_kb_triage_cat_v4 ON pi_kb_corpus_triage_v4(suggested_category_id);

-- index: idx_kb_triage_class_v4
CREATE INDEX idx_kb_triage_class_v4 ON pi_kb_corpus_triage_v4(term_kind,classification);

-- index: idx_kb_triage_entity_v4
CREATE INDEX idx_kb_triage_entity_v4 ON pi_kb_corpus_triage_v4(matched_injcode_id);

-- index: idx_pi_kb_name_type_norm_v4
CREATE INDEX idx_pi_kb_name_type_norm_v4
 ON pi_kb_names_v1(entity_type,LOWER(canonical_name));

-- view: Tree of Manufacturing - Nested
CREATE VIEW "Tree of Manufacturing - Nested" AS
WITH
  parts AS (
    SELECT
      t.product_category_id AS category_id,
      t.product_archetype_id AS archetype_id,
      t.product_configuration_id AS configuration_id,
      t.assembly_id,
      t.part_type_id,
      json_group_array(json_object(
        'mapping_id',t.mapping_id,
        'material_id',t.material_id,
        'material',m.name,
        'manufacturing_route_id',t.manufacturing_route_id,
        'manufacturing_route',r.name,
        'knowledge_status',t.knowledge_status,
        'engineering_conditions',t.engineering_conditions
      )) AS alternatives
    FROM "Tree of Manufacturing" t
    JOIN INJCODES m ON m.injcode_id=t.material_id
    JOIN INJCODES r ON r.injcode_id=t.manufacturing_route_id
    GROUP BY t.product_category_id,t.product_archetype_id,
             t.product_configuration_id,t.assembly_id,t.part_type_id
  ),
  assemblies AS (
    SELECT
      p.category_id,p.archetype_id,p.configuration_id,p.assembly_id,
      json_group_array(json_object(
        'part_id',p.part_type_id,'part',c.name,
        'material_route_options',json(p.alternatives)
      )) AS parts
    FROM parts p
    JOIN INJCODES c ON c.injcode_id=p.part_type_id
    GROUP BY p.category_id,p.archetype_id,p.configuration_id,p.assembly_id
  ),
  configurations AS (
    SELECT
      a.category_id,a.archetype_id,a.configuration_id,
      json_group_array(json_object(
        'assembly_id',a.assembly_id,'assembly',c.name,'parts',json(a.parts)
      )) AS assemblies
    FROM assemblies a
    JOIN INJCODES c ON c.injcode_id=a.assembly_id
    GROUP BY a.category_id,a.archetype_id,a.configuration_id
  ),
  archetypes AS (
    SELECT
      f.category_id,f.archetype_id,
      json_group_array(json_object(
        'configuration_id',f.configuration_id,'configuration',c.name,
        'assemblies',json(f.assemblies)
      )) AS configurations
    FROM configurations f
    JOIN INJCODES c ON c.injcode_id=f.configuration_id
    GROUP BY f.category_id,f.archetype_id
  ),
  categories AS (
    SELECT
      a.category_id,
      COUNT(*) AS archetype_count,
      json_group_array(json_object(
        'archetype_id',a.archetype_id,'archetype',c.name,
        'configurations',json(a.configurations)
      )) AS archetypes
    FROM archetypes a
    JOIN INJCODES c ON c.injcode_id=a.archetype_id
    GROUP BY a.category_id
  )
SELECT
 c.category_id AS product_category_id,
 cat.name AS product_category,
 c.archetype_count,
 json(c.archetypes) AS manufacturing_hierarchy_json
FROM categories c
JOIN INJCODES cat ON cat.injcode_id=c.category_id;

-- view: Tree of Manufacturing - Part Options
CREATE VIEW "Tree of Manufacturing - Part Options" AS
SELECT
 t.product_category_id,
 cat.name AS product_category,
 t.product_archetype_id,
 arch.name AS product_archetype,
 t.product_configuration_id,
 cfg.name AS product_configuration,
 t.assembly_id,
 asm.name AS assembly,
 t.part_type_id,
 part.name AS part_type,
 COUNT(*) AS valid_material_route_pairs,
 GROUP_CONCAT(DISTINCT t.material_id) AS possible_material_ids,
 GROUP_CONCAT(DISTINCT t.manufacturing_route_id) AS possible_route_ids,
 json_group_array(json_object(
   'mapping_id',t.mapping_id,
   'material_id',t.material_id,
   'material',mat.name,
   'route_id',t.manufacturing_route_id,
   'route',route.name,
   'status',t.knowledge_status,
   'conditions',t.engineering_conditions
 )) AS valid_material_route_pairs_json
FROM "Tree of Manufacturing" t
JOIN INJCODES cat ON cat.injcode_id=t.product_category_id
JOIN INJCODES arch ON arch.injcode_id=t.product_archetype_id
JOIN INJCODES cfg ON cfg.injcode_id=t.product_configuration_id
JOIN INJCODES asm ON asm.injcode_id=t.assembly_id
JOIN INJCODES part ON part.injcode_id=t.part_type_id
JOIN INJCODES mat ON mat.injcode_id=t.material_id
JOIN INJCODES route ON route.injcode_id=t.manufacturing_route_id
GROUP BY
 t.product_category_id,t.product_archetype_id,t.product_configuration_id,
 t.assembly_id,t.part_type_id;

-- view: pi_kb_archetype_coverage_v4
CREATE VIEW pi_kb_archetype_coverage_v4 AS
SELECT
 t.product_category_id,c.name AS product_category,
 t.product_archetype_id,a.name AS product_archetype,
 COUNT(DISTINCT t.product_configuration_id) AS configurations,
 COUNT(DISTINCT t.assembly_id) AS assemblies,
 COUNT(DISTINCT t.part_type_id) AS unique_part_types,
 COUNT(DISTINCT t.material_id) AS unique_materials,
 COUNT(DISTINCT t.manufacturing_route_id) AS unique_manufacturing_routes,
 COUNT(*) AS candidate_path_count,
 SUM(t.knowledge_status='reviewed') AS reviewed_path_count,
 SUM(t.knowledge_status='source_supported') AS source_supported_path_count
FROM "Tree of Manufacturing" t
JOIN INJCODES a ON a.injcode_id=t.product_archetype_id
JOIN INJCODES c ON c.injcode_id=t.product_category_id
GROUP BY t.product_category_id,t.product_archetype_id;

-- view: pi_kb_corpus_priority_v4
CREATE VIEW pi_kb_corpus_priority_v4 AS
SELECT
 l.normalized_term,l.occurrence_count,l.term_kind,
 t.classification,t.matched_injcode_id,
 x.name AS canonical_match,
 cat.name AS suggested_category,
 t.review_state,
 CASE WHEN t.classification='product_candidate' AND t.suggested_category_id IS NOT NULL
 THEN l.occurrence_count*3
 WHEN t.classification='product_candidate' THEN l.occurrence_count*2
 WHEN t.classification='material_candidate' THEN l.occurrence_count*2
 ELSE l.occurrence_count END AS review_priority_score
FROM pi_kb_corpus_triage_v4 t
JOIN pi_kb_lexicon_v2 l ON l.term_id=t.term_id
LEFT JOIN INJCODES x ON x.injcode_id=t.matched_injcode_id
LEFT JOIN INJCODES cat ON cat.injcode_id=t.suggested_category_id;

-- view: pi_kb_corpus_triage_readable_v4
CREATE VIEW pi_kb_corpus_triage_readable_v4 AS
 SELECT l.normalized_term,l.occurrence_count,l.term_kind,
        t.classification,t.strategy,t.review_state,
        t.matched_injcode_id AS injcode_id,
        c.name AS matched_canonical_name,c.entity_type AS matched_entity_type
 FROM pi_kb_corpus_triage_v4 t
 JOIN pi_kb_lexicon_v2 l ON l.term_id=t.term_id
 LEFT JOIN INJCODES c ON c.injcode_id=t.matched_injcode_id;

-- view: pi_kb_coverage_gap_v4
CREATE VIEW pi_kb_coverage_gap_v4 AS
SELECT 'single_configuration' AS gap_type,
 product_archetype_id AS reference_id,product_archetype AS reference_name,
 candidate_path_count AS existing_paths,
 'Only one configuration represented; not necessarily engineering complete' AS reason
FROM pi_kb_archetype_coverage_v4 WHERE configurations<2
UNION ALL
SELECT 'few_unique_parts',product_archetype_id,product_archetype,candidate_path_count,
 'Fewer than five unique parts mapped for this archetype'
FROM pi_kb_archetype_coverage_v4 WHERE unique_part_types<5
UNION ALL
SELECT 'no_verified_relationships',product_archetype_id,product_archetype,candidate_path_count,
 'No independently reviewed or source-supported technical relationships'
FROM pi_kb_archetype_coverage_v4
WHERE reviewed_path_count+source_supported_path_count=0;

-- view: pi_kb_quality_issues_v4
CREATE VIEW pi_kb_quality_issues_v4 AS
SELECT 'missing_public_mapping' AS issue,r.route_id AS reference
 FROM pi_product_part_routes_v1 r
 LEFT JOIN "Tree of Manufacturing" m ON m.original_seed_route_id=r.route_id
 WHERE m.mapping_id IS NULL
UNION ALL
SELECT 'unmatched_name_ID',CAST(t.mapping_id AS TEXT)
 FROM "Tree of Manufacturing" t
 LEFT JOIN INJCODES n ON n.injcode_id=t.part_type_id
 WHERE n.injcode_id IS NULL
UNION ALL
SELECT 'knowledge_status_disagreement',CAST(t.mapping_id AS TEXT)
 FROM "Tree of Manufacturing" t
 JOIN pi_product_part_routes_v1 r ON r.route_id=t.original_seed_route_id
 WHERE t.knowledge_status<>r.knowledge_status
UNION ALL
SELECT 'missing_engineering_conditions',CAST(mapping_id AS TEXT)
 FROM "Tree of Manufacturing" WHERE TRIM(engineering_conditions)=''
UNION ALL
SELECT 'unprocessed_corpus_term',CAST(l.term_id AS TEXT)
 FROM pi_kb_lexicon_v2 l LEFT JOIN pi_kb_corpus_triage_v4 t ON t.term_id=l.term_id
 WHERE t.term_id IS NULL;
