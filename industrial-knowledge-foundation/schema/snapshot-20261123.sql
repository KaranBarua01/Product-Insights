-- Cloudflare D1 schema snapshot, 2026-11-23.
-- For documentary/rebuild reference; inspect dependencies/order before importing.
-- Never apply to production without review. No company mapping tables.

-- table pi_kb_aliases_v2
CREATE TABLE pi_kb_aliases_v2 (
 entity_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
 alias_text TEXT NOT NULL,
 alias_norm TEXT NOT NULL,
 alias_kind TEXT NOT NULL DEFAULT 'synonym' CHECK(alias_kind IN ('synonym','acronym','plural','search_variant')),
 review_status TEXT NOT NULL DEFAULT 'candidate',
 PRIMARY KEY(entity_id,alias_norm)
);

-- table pi_kb_corpus_runs_v2
CREATE TABLE pi_kb_corpus_runs_v2 (
 run_id TEXT PRIMARY KEY,
 source_table TEXT NOT NULL,
 total_source_records INTEGER NOT NULL,
 product_phrases INTEGER NOT NULL,
 material_tokens INTEGER NOT NULL,
 commodity_tokens INTEGER NOT NULL,
 run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 notes TEXT NOT NULL
);

-- table pi_kb_hierarchy_edges_v1
CREATE TABLE pi_kb_hierarchy_edges_v1 (
  parent_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  child_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  relation TEXT NOT NULL CHECK (relation IN
    ('CATEGORY_ARCHETYPE','ARCHETYPE_CONFIGURATION','CONFIGURATION_ASSEMBLY','ASSEMBLY_PART')),
  PRIMARY KEY(parent_id,child_id,relation)
);

-- table pi_kb_lexicon_v2
CREATE TABLE pi_kb_lexicon_v2 (
 term_id INTEGER PRIMARY KEY AUTOINCREMENT,
 term_kind TEXT NOT NULL CHECK(term_kind IN ('product_phrase','material_token','commodity_token')),
 normalized_term TEXT NOT NULL,
 occurrence_count INTEGER NOT NULL CHECK(occurrence_count>0),
 quality_status TEXT NOT NULL DEFAULT 'unreviewed_corpus_term' CHECK (quality_status IN ('unreviewed_corpus_term','promoted','rejected','ambiguous')),
 extraction_version TEXT NOT NULL DEFAULT 'v2_delimiter_split',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(term_kind,normalized_term)
);

-- table pi_kb_names_v1
CREATE TABLE pi_kb_names_v1 (
  entity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN
    ('category','archetype','configuration','assembly','part','material','route','route_step')),
  entity_key TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  record_status TEXT NOT NULL DEFAULT 'candidate_from_seed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type,entity_key)
);

-- table pi_kb_part_route_map_v1
CREATE TABLE pi_kb_part_route_map_v1 (
  mapping_id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  part_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  material_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  route_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  seed_route_id TEXT NOT NULL UNIQUE REFERENCES pi_product_part_routes_v1(route_id),
  engineering_conditions TEXT NOT NULL DEFAULT '',
  knowledge_status TEXT NOT NULL DEFAULT 'engineering_hypothesis'
    CHECK(knowledge_status IN ('engineering_hypothesis','source_supported','reviewed','rejected')),
  UNIQUE(assembly_id,part_id,material_id,route_id)
);

-- table pi_kb_review_queue_v2
CREATE TABLE pi_kb_review_queue_v2 (
 review_id INTEGER PRIMARY KEY AUTOINCREMENT,
 proposal_type TEXT NOT NULL CHECK (proposal_type IN ('archetype','part','material','route','compatibility','alias','hierarchy')),
 proposal_json TEXT NOT NULL CHECK (json_valid(proposal_json)),
 rationale TEXT NOT NULL,
 seed_origin TEXT NOT NULL CHECK(seed_origin IN ('dictionary_mining','engineering_reasoning','official_source','external_reference','review_feedback')),
 review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','accepted','rejected','ambiguous')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 reviewed_at TEXT,
 reviewer TEXT
);

-- table pi_kb_route_step_map_v1
CREATE TABLE pi_kb_route_step_map_v1 (
  route_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  step_order INTEGER NOT NULL CHECK(step_order>0),
  step_id INTEGER NOT NULL REFERENCES pi_kb_names_v1(entity_id),
  PRIMARY KEY(route_id,step_order)
);

-- table pi_kb_sources_v2
CREATE TABLE pi_kb_sources_v2 (
 source_id TEXT PRIMARY KEY,
 entity_id INTEGER REFERENCES pi_kb_names_v1(entity_id),
 mapping_id INTEGER REFERENCES pi_kb_part_route_map_v1(mapping_id),
 source_url TEXT NOT NULL,
 source_type TEXT NOT NULL,
 source_locator TEXT,
 exact_quote TEXT,
 claim_type TEXT NOT NULL,
 review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(review_status IN ('unreviewed','accepted','rejected','ambiguous')),
 source_hash TEXT,
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- table pi_product_part_routes_v1
CREATE TABLE pi_product_part_routes_v1 (
  route_id TEXT PRIMARY KEY,
  product_category TEXT NOT NULL,
  archetype_key TEXT NOT NULL,
  product_archetype TEXT NOT NULL,
  product_configuration TEXT NOT NULL,
  assembly TEXT NOT NULL,
  part_type TEXT NOT NULL,
  material TEXT NOT NULL,
  manufacturing_route TEXT NOT NULL,
  route_steps_json TEXT NOT NULL CHECK (json_valid(route_steps_json)),
  engineering_conditions TEXT NOT NULL,
  knowledge_status TEXT NOT NULL DEFAULT 'engineering_hypothesis'
    CHECK(knowledge_status IN ('engineering_hypothesis','source_supported','reviewed','rejected')),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  seed_origin TEXT NOT NULL DEFAULT 'reasoned_template_not_company_fact',
  seed_version TEXT NOT NULL DEFAULT 'v1.0.0',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(archetype_key,product_configuration,assembly,part_type,material,manufacturing_route)
);

-- view pi_kb_integrity_issues_v2
CREATE VIEW pi_kb_integrity_issues_v2 AS
SELECT 'orphaned_mapping' AS issue,CAST(m.mapping_id AS TEXT) AS reference
FROM pi_kb_part_route_map_v1 m
LEFT JOIN pi_kb_product_tree_v1 t ON t.mapping_id=m.mapping_id
WHERE t.mapping_id IS NULL
UNION ALL
SELECT 'duplicate_readable_mapping',CAST(mapping_id AS TEXT)
FROM pi_kb_product_tree_v1 GROUP BY mapping_id HAVING COUNT(*)<>1
UNION ALL
SELECT 'unapproved_route_without_conditions',CAST(mapping_id AS TEXT)
FROM pi_kb_part_route_map_v1
WHERE knowledge_status='engineering_hypothesis' AND TRIM(engineering_conditions)=''
UNION ALL
SELECT 'invalid_name_key',CAST(entity_id AS TEXT)
FROM pi_kb_names_v1 WHERE TRIM(entity_key)='' OR TRIM(canonical_name)='';

-- view pi_kb_product_tree_v1
CREATE VIEW pi_kb_product_tree_v1 AS
SELECT
 cat.entity_id AS category_id,cat.canonical_name AS product_category,
 arch.entity_id AS archetype_id,arch.canonical_name AS product_archetype,
 conf.entity_id AS configuration_id,conf.canonical_name AS product_configuration,
 asm.entity_id AS assembly_id,asm.canonical_name AS assembly,
 part.entity_id AS part_id,part.canonical_name AS part_type,
 mat.entity_id AS material_id,mat.canonical_name AS material,
 route.entity_id AS route_id,route.canonical_name AS manufacturing_route,
 opt.mapping_id AS mapping_id,
 opt.knowledge_status AS knowledge_status,
 opt.engineering_conditions AS engineering_conditions,
 opt.seed_route_id AS original_seed_route_id
FROM pi_kb_part_route_map_v1 opt
JOIN pi_kb_names_v1 asm ON asm.entity_id=opt.assembly_id AND asm.entity_type='assembly'
JOIN pi_kb_names_v1 part ON part.entity_id=opt.part_id AND part.entity_type='part'
JOIN pi_kb_names_v1 mat ON mat.entity_id=opt.material_id AND mat.entity_type='material'
JOIN pi_kb_names_v1 route ON route.entity_id=opt.route_id AND route.entity_type='route'
JOIN pi_kb_hierarchy_edges_v1 epart ON epart.parent_id=asm.entity_id AND epart.child_id=part.entity_id AND epart.relation='ASSEMBLY_PART'
JOIN pi_kb_hierarchy_edges_v1 easm ON easm.child_id=asm.entity_id AND easm.relation='CONFIGURATION_ASSEMBLY'
JOIN pi_kb_names_v1 conf ON conf.entity_id=easm.parent_id AND conf.entity_type='configuration'
JOIN pi_kb_hierarchy_edges_v1 econf ON econf.child_id=conf.entity_id AND econf.relation='ARCHETYPE_CONFIGURATION'
JOIN pi_kb_names_v1 arch ON arch.entity_id=econf.parent_id AND arch.entity_type='archetype'
JOIN pi_kb_hierarchy_edges_v1 earch ON earch.child_id=arch.entity_id AND earch.relation='CATEGORY_ARCHETYPE'
JOIN pi_kb_names_v1 cat ON cat.entity_id=earch.parent_id AND cat.entity_type='category';

-- view pi_kb_quality_summary_v2
CREATE VIEW pi_kb_quality_summary_v2 AS
SELECT
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='category') product_categories,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='archetype') product_archetypes,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='configuration') configurations,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='assembly') assemblies,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='part') part_types,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='material') canonical_materials,
 (SELECT COUNT(*) FROM pi_kb_names_v1 WHERE entity_type='route') manufacturing_routes,
 (SELECT COUNT(*) FROM pi_kb_part_route_map_v1) candidate_routes,
 (SELECT COUNT(*) FROM pi_kb_product_tree_v1) readable_paths,
 (SELECT COUNT(*) FROM pi_kb_review_queue_v2 WHERE review_status='pending') review_proposals,
 (SELECT COUNT(*) FROM pi_kb_sources_v2 WHERE review_status='accepted') accepted_sources;
