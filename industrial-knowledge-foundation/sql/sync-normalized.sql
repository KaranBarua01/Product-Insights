-- Idempotent normalization of pi_product_part_routes_v1 into canonical ID-based tables.
-- No company fields, IDs or linking. Apply after the schema and seed are installed.
-- If a single archetype belongs to two categories, the original v1 read view can
-- duplicate paths; do not silently treat that as one-to-many valid category evidence.

INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'category',LOWER(TRIM(product_category)),TRIM(product_category) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'archetype',archetype_key,TRIM(product_archetype) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'configuration',archetype_key||'|'||LOWER(TRIM(product_configuration)),TRIM(product_configuration) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'assembly',archetype_key||'|'||LOWER(TRIM(product_configuration))||'|'||LOWER(TRIM(assembly)),TRIM(assembly) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'part',LOWER(TRIM(part_type)),TRIM(part_type) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'material',LOWER(TRIM(material)),TRIM(material) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'route',LOWER(TRIM(manufacturing_route)),TRIM(manufacturing_route) FROM pi_product_part_routes_v1;
INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name)
 SELECT DISTINCT 'route_step',LOWER(TRIM(json_extract(j.value,'$.process'))),TRIM(json_extract(j.value,'$.process'))
 FROM pi_product_part_routes_v1 r,json_each(r.route_steps_json) j;

INSERT OR IGNORE INTO pi_kb_hierarchy_edges_v1(parent_id,child_id,relation)
 SELECT DISTINCT c.entity_id,a.entity_id,'CATEGORY_ARCHETYPE'
 FROM pi_product_part_routes_v1 r
 JOIN pi_kb_names_v1 c ON c.entity_type='category' AND c.entity_key=LOWER(TRIM(r.product_category))
 JOIN pi_kb_names_v1 a ON a.entity_type='archetype' AND a.entity_key=r.archetype_key;
INSERT OR IGNORE INTO pi_kb_hierarchy_edges_v1(parent_id,child_id,relation)
 SELECT DISTINCT a.entity_id,f.entity_id,'ARCHETYPE_CONFIGURATION'
 FROM pi_product_part_routes_v1 r
 JOIN pi_kb_names_v1 a ON a.entity_type='archetype' AND a.entity_key=r.archetype_key
 JOIN pi_kb_names_v1 f ON f.entity_type='configuration' AND f.entity_key=r.archetype_key||'|'||LOWER(TRIM(r.product_configuration));
INSERT OR IGNORE INTO pi_kb_hierarchy_edges_v1(parent_id,child_id,relation)
 SELECT DISTINCT f.entity_id,s.entity_id,'CONFIGURATION_ASSEMBLY'
 FROM pi_product_part_routes_v1 r
 JOIN pi_kb_names_v1 f ON f.entity_type='configuration' AND f.entity_key=r.archetype_key||'|'||LOWER(TRIM(r.product_configuration))
 JOIN pi_kb_names_v1 s ON s.entity_type='assembly' AND s.entity_key=r.archetype_key||'|'||LOWER(TRIM(r.product_configuration))||'|'||LOWER(TRIM(r.assembly));
INSERT OR IGNORE INTO pi_kb_hierarchy_edges_v1(parent_id,child_id,relation)
 SELECT DISTINCT s.entity_id,p.entity_id,'ASSEMBLY_PART'
 FROM pi_product_part_routes_v1 r
 JOIN pi_kb_names_v1 s ON s.entity_type='assembly' AND s.entity_key=r.archetype_key||'|'||LOWER(TRIM(r.product_configuration))||'|'||LOWER(TRIM(r.assembly))
 JOIN pi_kb_names_v1 p ON p.entity_type='part' AND p.entity_key=LOWER(TRIM(r.part_type));

INSERT OR IGNORE INTO pi_kb_part_route_map_v1
 (assembly_id,part_id,material_id,route_id,seed_route_id,engineering_conditions,knowledge_status)
 SELECT a.entity_id,p.entity_id,m.entity_id,t.entity_id,r.route_id,r.engineering_conditions,r.knowledge_status
 FROM pi_product_part_routes_v1 r
 JOIN pi_kb_names_v1 a ON a.entity_type='assembly' AND a.entity_key=r.archetype_key||'|'||LOWER(TRIM(r.product_configuration))||'|'||LOWER(TRIM(r.assembly))
 JOIN pi_kb_names_v1 p ON p.entity_type='part' AND p.entity_key=LOWER(TRIM(r.part_type))
 JOIN pi_kb_names_v1 m ON m.entity_type='material' AND m.entity_key=LOWER(TRIM(r.material))
 JOIN pi_kb_names_v1 t ON t.entity_type='route' AND t.entity_key=LOWER(TRIM(r.manufacturing_route));

INSERT OR IGNORE INTO pi_kb_route_step_map_v1(route_id,step_order,step_id)
 SELECT DISTINCT t.entity_id,CAST(json_extract(j.value,'$.order') AS INTEGER),s.entity_id
 FROM pi_product_part_routes_v1 r,json_each(r.route_steps_json) j
 JOIN pi_kb_names_v1 t ON t.entity_type='route' AND t.entity_key=LOWER(TRIM(r.manufacturing_route))
 JOIN pi_kb_names_v1 s ON s.entity_type='route_step' AND s.entity_key=LOWER(TRIM(json_extract(j.value,'$.process')))
 WHERE CAST(json_extract(j.value,'$.order') AS INTEGER)>0;
