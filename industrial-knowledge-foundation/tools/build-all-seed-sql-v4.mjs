#!/usr/bin/env node
/**
 * Product Insights Industrial Knowledge Foundation seed compiler.
 * Reads versioned, company-INDEPENDENT candidate route data and writes an
 * idempotent SQLite / Cloudflare D1 seed file. DOES NOT contact external AI,
 * access accounts, modify D1, or connect products to companies.
 *
 * Usage:
 *   node industrial-knowledge-foundation/tools/build-all-seed-sql-v4.mjs
 *   node industrial-knowledge-foundation/tools/build-all-seed-sql-v4.mjs /tmp/out.sql
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const files = [
  'route-candidates-v2.json',
  ...readdirSync(dataDir).filter(f=> /^routes-v3\.0-[A-E]\.json$/.test(f)).sort(),
  ...readdirSync(dataDir).filter(f=> /^routes-v4\.1-(?:curated|alternatives)\.json$/.test(f)).sort()
];
const columns = [
 'route_id','product_category','archetype_key','product_archetype',
 'product_configuration','assembly','part_type','material','manufacturing_route',
 'route_steps_json','engineering_conditions','knowledge_status','seed_origin','seed_version'
];
const quote = v=>v==null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'";
const seenRoutes = new Set();
const seenLinks = new Set();
const archetypeToParent = new Map();
const sql = [
 '-- Company-independent product-engineering hypotheses. Not verified manufacturing facts.',
 '-- Apply after installing the matching schema; then run sql/sync-normalized.sql',
 '-- and sql/INJCODES_and_Tree_of_Manufacturing.sql to sync numeric IDs.',
 'BEGIN TRANSACTION;'
];
let count = 0;
for (const file of files) {
 const pack = JSON.parse(readFileSync(resolve(dataDir,file), 'utf8'));
 if (!Array.isArray(pack.records) || pack.record_count!==pack.records.length)
   throw new Error('Record count mismatch in ' + file);
 for (const row of pack.records) {
  if (!row.route_id || seenRoutes.has(row.route_id))
    throw new Error('Duplicate/missing route ID ' + row.route_id);
  if (row.knowledge_status!=='engineering_hypothesis')
    throw new Error('Seed contains an unsubstantiated verification status: '+row.route_id);
  if (!row.engineering_conditions || !row.engineering_conditions.trim())
    throw new Error('Missing engineering conditions '+row.route_id);
  const steps=JSON.parse(row.route_steps_json);
  if (!Array.isArray(steps) || !steps.length ||
      steps.some((step,i)=>step.order!==i+1 || !step.process))
    throw new Error('Invalid ordered route steps: '+row.route_id);
  const parent = archetypeToParent.get(row.archetype_key);
  if (parent && (parent.category!==row.product_category || parent.name!==row.product_archetype))
    throw new Error('Archetype key has conflicting categories/names: '+row.archetype_key);
  archetypeToParent.set(row.archetype_key,{category:row.product_category,name:row.product_archetype});
  const link = [row.archetype_key,row.product_configuration,row.assembly,
      row.part_type,row.material,row.manufacturing_route].join('\u0001');
  if (seenLinks.has(link)) throw new Error('Duplicated engineering path: '+row.route_id);
  seenLinks.add(link);
  seenRoutes.add(row.route_id);
  sql.push('INSERT OR IGNORE INTO pi_product_part_routes_v1 ('+columns.join(',')+
      ') VALUES ('+columns.map(k=>quote(row[k])).join(',')+');');
  count++;
 }
}
sql.push('COMMIT;','');
const target=process.argv[2]?resolve(process.argv[2]):resolve(dataDir,'seed-all-v4-generated.sql');
writeFileSync(target,sql.join('\n'),'utf8');
process.stdout.write(JSON.stringify({
 files:files.length,archetypes:archetypeToParent.size,routeCount:count,output:target
})+'\n');
