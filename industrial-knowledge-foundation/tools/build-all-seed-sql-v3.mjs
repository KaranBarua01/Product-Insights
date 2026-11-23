#!/usr/bin/env node
// Company-independent seed generator. Writes a SQL file, never touches D1.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(root, 'data');
const files = ['route-candidates-v2.json',
  ...readdirSync(folder).filter(x => /^routes-v3\.0-[A-E]\.json$/.test(x)).sort()];
const col = ['route_id','product_category','archetype_key','product_archetype',
  'product_configuration','assembly','part_type','material','manufacturing_route',
  'route_steps_json','engineering_conditions','knowledge_status','seed_origin','seed_version'];
const esc = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const uniqIds = new Set(), uniqMapping = new Set(), archetypeParents = new Map();
const lines = [
  '-- Generated from Product Insights version-controlled route hypotheses.',
  '-- IDs resolve through sql/sync-normalized.sql. NO COMPANY LINKS.',
  '-- Engineering hypotheses are candidate routes, NOT verified manufacturing facts.',
  'BEGIN TRANSACTION;'
];
let total = 0;
for (const filename of files) {
  const seed = JSON.parse(readFileSync(resolve(folder,filename), 'utf8'));
  if (!Array.isArray(seed.records) || seed.records.length !== seed.record_count) {
    throw new Error('Count mismatch: ' + filename);
  }
  for (const record of seed.records) {
    if (!record.route_id || uniqIds.has(record.route_id)) throw new Error('Duplicate/missing route ID: ' + record.route_id);
    if (record.knowledge_status !== 'engineering_hypothesis') throw new Error('Unreviewed seed cannot claim verification: ' + record.route_id);
    if (!record.engineering_conditions?.trim()) throw new Error('Missing compatibility/engineering condition: '+record.route_id);
    const steps = JSON.parse(record.route_steps_json);
    if (!Array.isArray(steps) || steps.length<1 || steps.some((s,i)=>s.order!==i+1 || !s.process)) {
      throw new Error('Invalid route steps: ' + record.route_id);
    }
    const parent=archetypeParents.get(record.archetype_key);
    if (parent && (parent.product_category!==record.product_category || parent.product_archetype!==record.product_archetype)) {
      throw new Error('Archetype has multiple categories or conflicting names: ' + record.archetype_key);
    }
    archetypeParents.set(record.archetype_key,{
      product_category:record.product_category,product_archetype:record.product_archetype
    });
    const mapping = [
      record.archetype_key, record.product_configuration,record.assembly,
      record.part_type,record.material,record.manufacturing_route
    ].join('\u0001');
    if (uniqMapping.has(mapping)) throw new Error('Duplicate engineering mapping: '+record.route_id);
    uniqMapping.add(mapping);uniqIds.add(record.route_id);total++;
    lines.push('INSERT OR IGNORE INTO pi_product_part_routes_v1 ('+col.join(',')+
       ') VALUES ('+col.map(k=>esc(record[k])).join(',')+');');
  }
}
lines.push('COMMIT;', '');
const out = process.argv[2] ? resolve(process.argv[2]) : resolve(root,'data/seed-all-v3-generated.sql');
writeFileSync(out, lines.join('\n'),'utf8');
process.stdout.write(JSON.stringify({seedFiles:files.length,routeCount:total,archetypes:archetypeParents.size,output:out})+'\n');
