#!/usr/bin/env node
/** Build an idempotent SQL fixture for V4 material alternatives and candidate aliases.
 * Does not access Cloudflare, companies, external models, or network services.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=resolve(dirname(fileURLToPath(import.meta.url)),'..','data');
const rules=JSON.parse(readFileSync(resolve(dir,'material-route-rules-v4.json'),'utf8'));
const aliases=JSON.parse(readFileSync(resolve(dir,'curated-phrase-aliases-v4.json'),'utf8'));
const q=v=>v==null?'NULL':"'" + String(v).replaceAll("'", "''") + "'";
for(const data of [rules,aliases]){
 if(!Array.isArray(data.records)||data.records.length!==data.record_count)
   throw new Error('Fixture count mismatch');
}
const ruleCols=[
 'rule_id','part_name_like','source_material','product_category_filter',
 'alternative_material','alternative_route','route_steps_json',
 'engineering_conditions','review_status'
];
const statements=[
 '-- Candidate engineering rules and lexical aliases, not independently verified.',
 '-- Apply only after V4 tables and base INJCODES entities exist.',
 'BEGIN TRANSACTION;',
 ...rules.records.map(r=>
  'INSERT OR IGNORE INTO pi_kb_material_route_rules_v4 ('+
  ruleCols.join(',')+') VALUES ('+ruleCols.map(k=>q(r[k])).join(',')+');'
 ),
 ...aliases.records.map(a=>
  'INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4 '+
  '(alias_key,injcode_id,entity_type,alias_rule) '+
  'SELECT '+q(a.alias_key)+',entity_id,'+q(a.entity_type)+','+q(a.alias_rule)+
  ' FROM pi_kb_names_v1 WHERE entity_type='+q(a.entity_type)+
  ' AND entity_key='+q(a.entity_key)+';'
 ),
 'COMMIT;', ''
];
const out=process.argv[2]?resolve(process.argv[2]):resolve(dir,'seed-rules-aliases-v4-generated.sql');
writeFileSync(out,statements.join('\n'),'utf8');
process.stdout.write(JSON.stringify({rules:rules.records.length,aliases:aliases.records.length,output:out})+'\n');
