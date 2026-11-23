-- Product Insights readable grouped manufacturing hierarchy views.
-- Additive only; INJCODES and "Tree of Manufacturing" remain the two physical tables.
-- One row per scoped part for alternatives; one row per category for nested graph.
-- Material and route choices remain paired, not combined into an invalid cross product.

-- Tree of Manufacturing - Nested
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

-- Tree of Manufacturing - Part Options
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
