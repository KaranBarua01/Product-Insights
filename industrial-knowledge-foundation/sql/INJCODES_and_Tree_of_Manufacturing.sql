-- Product Insights: two public-facing physical tables.
-- Exact table names: INJCODES, "Tree of Manufacturing".
-- Company-independent. Existing internal KB tables are retained.
-- D1 / SQLite. Re-run the INSERT/UPSERT statements after the internal graph changes.
-- This file is idempotent. A later full migration may add deletion reconciliation.

CREATE TABLE IF NOT EXISTS INJCODES (
  injcode_id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN (
    'category','archetype','configuration','assembly','part','material','route','route_step'
  )),
  entity_key TEXT NOT NULL,
  name TEXT NOT NULL,
  record_status TEXT NOT NULL DEFAULT 'candidate_from_seed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type,entity_key)
);
CREATE INDEX IF NOT EXISTS idx_injcodes_type_name
  ON INJCODES(entity_type,name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS "Tree of Manufacturing" (
  mapping_id INTEGER PRIMARY KEY,
  product_category_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  product_archetype_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  product_configuration_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  assembly_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  part_type_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  material_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  manufacturing_route_id INTEGER NOT NULL REFERENCES INJCODES(injcode_id),
  knowledge_status TEXT NOT NULL DEFAULT 'engineering_hypothesis'
    CHECK(knowledge_status IN('engineering_hypothesis','source_supported','reviewed','rejected')),
  engineering_conditions TEXT NOT NULL DEFAULT '',
  original_seed_route_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_category_id,product_archetype_id,product_configuration_id,
         assembly_id,part_type_id,material_id,manufacturing_route_id)
);
CREATE INDEX IF NOT EXISTS idx_tom_category_archetype ON "Tree of Manufacturing"(product_category_id,product_archetype_id);
CREATE INDEX IF NOT EXISTS idx_tom_archetype_config ON "Tree of Manufacturing"(product_archetype_id,product_configuration_id);
CREATE INDEX IF NOT EXISTS idx_tom_config_assembly ON "Tree of Manufacturing"(product_configuration_id,assembly_id);
CREATE INDEX IF NOT EXISTS idx_tom_assembly_part ON "Tree of Manufacturing"(assembly_id,part_type_id);
CREATE INDEX IF NOT EXISTS idx_tom_part_material ON "Tree of Manufacturing"(part_type_id,material_id);
CREATE INDEX IF NOT EXISTS idx_tom_material_route ON "Tree of Manufacturing"(material_id,manufacturing_route_id);

-- First insert canonical IDs and names; preserve existing numeric IDs.
INSERT INTO INJCODES(injcode_id,entity_type,entity_key,name,record_status,created_at)
SELECT entity_id,entity_type,entity_key,canonical_name,record_status,created_at
FROM pi_kb_names_v1 WHERE 1
ON CONFLICT(injcode_id) DO UPDATE SET
 entity_type=excluded.entity_type,
 entity_key=excluded.entity_key,
 name=excluded.name,
 record_status=excluded.record_status;

-- Then map the complete seven-level ID paths.
INSERT INTO "Tree of Manufacturing" (
 mapping_id,product_category_id,product_archetype_id,product_configuration_id,
 assembly_id,part_type_id,material_id,manufacturing_route_id,
 knowledge_status,engineering_conditions,original_seed_route_id
)
SELECT mapping_id,category_id,archetype_id,configuration_id,
       assembly_id,part_id,material_id,route_id,
       knowledge_status,engineering_conditions,original_seed_route_id
FROM pi_kb_product_tree_v1 WHERE 1
ON CONFLICT(mapping_id) DO UPDATE SET
 product_category_id=excluded.product_category_id,
 product_archetype_id=excluded.product_archetype_id,
 product_configuration_id=excluded.product_configuration_id,
 assembly_id=excluded.assembly_id,
 part_type_id=excluded.part_type_id,
 material_id=excluded.material_id,
 manufacturing_route_id=excluded.manufacturing_route_id,
 knowledge_status=excluded.knowledge_status,
 engineering_conditions=excluded.engineering_conditions,
 original_seed_route_id=excluded.original_seed_route_id;

-- Expect INJCODES=3047 and Tree=2590 at initial creation on 2026-11-23.
SELECT (SELECT COUNT(*) FROM INJCODES) AS injcodes_total,
       (SELECT COUNT(*) FROM "Tree of Manufacturing") AS mapping_total,
       (SELECT COUNT(*) FROM pi_kb_product_tree_v1) AS source_total;
SELECT COUNT(*) AS unresolved_rows
FROM "Tree of Manufacturing" t LEFT JOIN pi_kb_product_tree_v1 s ON s.mapping_id=t.mapping_id
WHERE s.mapping_id IS NULL;
PRAGMA foreign_key_check;
