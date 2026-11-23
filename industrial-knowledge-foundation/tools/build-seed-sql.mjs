#!/usr/bin/env node
// Generate an idempotent Cloudflare D1/SQLite seed script; writes no database.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(here, '../data/route-candidates-v2.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const cols = ['route_id','product_category','archetype_key','product_archetype',
  'product_configuration','assembly','part_type','material','manufacturing_route',
  'route_steps_json','engineering_conditions','knowledge_status','seed_origin','seed_version'];
if (!Array.isArray(data.records) || data.records.length !== data.record_count) {
  throw new Error('Seed record count mismatch');
}
const escapeSql = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const ids = new Set();
for (const row of data.records) {
  if (!row.route_id || ids.has(row.route_id)) throw new Error('Duplicate/missing route_id');
  if (row.knowledge_status !== 'engineering_hypothesis')
    throw new Error('Only unverified engineering hypotheses allowed in this seed');
  if (!row.engineering_conditions?.trim()) throw new Error('Engineering conditions required');
  const steps = JSON.parse(row.route_steps_json);
  if (!Array.isArray(steps) || !steps.length ||
      steps.some((s, i) => s.order !== i + 1 || !s.process))
    throw new Error('Invalid route step list for ' + row.route_id);
  ids.add(row.route_id);
}
const sql = [
  '-- Idempotent V2 engineering hypothesis seed; assumes schema already applied.',
  '-- Does not associate any company or website with any product.',
  'BEGIN TRANSACTION;',
  ...data.records.map(row => `INSERT OR IGNORE INTO pi_product_part_routes_v1
(${cols.join(', ')})
VALUES (${cols.map(col => escapeSql(row[col])).join(', ')});`),
  'COMMIT;',
  '',
].join('\n');
const out = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '../data/seed-v2-generated.sql');
writeFileSync(out, sql, 'utf8');
process.stdout.write(JSON.stringify({ routes: data.records.length, output: out }) + '\n');
