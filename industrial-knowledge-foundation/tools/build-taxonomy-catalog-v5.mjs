#!/usr/bin/env node
/**
 * Product Insights V5 -- deterministic, company-independent taxonomy seed builder.
 * No network calls, no external models, no company-to-product associations.
 * Requires base KB + V5 schema; run first in a backed-up development D1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = filename => {
 const parsed = JSON.parse(readFileSync(resolve(root, 'data', filename), 'utf8'));
 if (!Array.isArray(parsed.records) || parsed.records.length !== parsed.record_count)
  throw new Error('Invalid record count: ' + filename);
 return parsed.records;
};
const curation = read('taxonomy-curation-v5.json');
const exceptions = read('phrase-exceptions-v5.json');
const patterns = read('resolution-patterns-v5.json');
const q = v => v == null ? 'NULL' : "'" + String(v).replaceAll("'", "''") + "'";
for (const [rows, key] of [[curation,'phrase'],[exceptions,'phrase'],[patterns,'rule_key']]) {
 if (new Set(rows.map(r => r[key])).size !== rows.length) throw new Error('Duplicated ' + key);
}
const sql = [
 '-- Candidate taxonomy only. Never treat these proposals as source-verified product BOMs.',
 '-- Apply base schema and V5 table definitions first.'
];
function insertRow(table, columns, values) {
 sql.push('INSERT OR IGNORE INTO ' + table + '(' + columns.join(',') + ') VALUES (' +
 columns.map((k,i)=>q(values[i])).join(',') + ');');
}
for (const r of exceptions)
 insertRow('pi_kb_phrase_exceptions_v5',
 ['phrase','disposition','category_name','rationale'],
 [r.phrase,r.disposition,r.category_name,r.rationale]);
for (const r of patterns)
 insertRow('pi_kb_resolution_patterns_v5',
 ['priority','rule_key','mode','pattern','disposition','category_name','rationale'],
 [r.priority,r.rule_key,r.mode,r.pattern,r.disposition,r.category_name,r.rationale]);
for (const c of curation) {
 if (!['new_archetype','alias_existing','scope_review'].includes(c.decision))
  throw new Error('Unknown curation decision: ' + c.decision);
 const existingKey = c.target_entity_key && c.decision==='alias_existing'
  ? c.target_entity_key : c.proposed_entity_key;
 const target = "(SELECT entity_id FROM pi_kb_names_v1 WHERE entity_type='archetype' AND entity_key="+q(existingKey)+")";
 sql.push(
  'INSERT OR IGNORE INTO pi_kb_archetype_curation_v5 '+
  '(phrase,proposed_canonical_name,proposed_entity_key,proposed_category,decision,'+
  'source_term_id,target_injcode_id,reviewer_basis,quality_status) '+
  'SELECT '+q(c.phrase)+','+q(c.proposed_canonical_name)+','+q(c.proposed_entity_key)+','+
  q(c.proposed_category)+','+q(c.decision)+',l.term_id,'+target+','+
  q(c.reviewer_basis)+','+q(c.quality_status)+
  ' FROM pi_kb_lexicon_v2 l WHERE l.term_kind=\'product_phrase\' AND l.normalized_term='+q(c.phrase)+';'
 );
}
sql.push(
 "INSERT OR IGNORE INTO pi_kb_names_v1(entity_type,entity_key,canonical_name,record_status) "+
 "SELECT 'archetype',proposed_entity_key,proposed_canonical_name,'provisional_corpus_taxonomy_v5' "+
 "FROM pi_kb_archetype_curation_v5 WHERE decision='new_archetype';"
);
sql.push(
 "INSERT OR IGNORE INTO pi_kb_hierarchy_edges_v1(parent_id,child_id,relation) "+
 "SELECT cat.entity_id,arch.entity_id,'CATEGORY_ARCHETYPE' FROM pi_kb_archetype_curation_v5 c "+
 "JOIN pi_kb_names_v1 cat ON cat.entity_type='category' AND cat.canonical_name=c.proposed_category "+
 "JOIN pi_kb_names_v1 arch ON arch.entity_type='archetype' AND arch.entity_key=c.proposed_entity_key "+
 "WHERE c.decision='new_archetype';"
);
sql.push(
 "INSERT INTO INJCODES(injcode_id,entity_type,entity_key,name,record_status,created_at) "+
 "SELECT entity_id,entity_type,entity_key,canonical_name,record_status,created_at "+
 "FROM pi_kb_names_v1 WHERE 1 ON CONFLICT(injcode_id) DO UPDATE SET "+
 "entity_type=excluded.entity_type,entity_key=excluded.entity_key,name=excluded.name,"+
 "record_status=excluded.record_status;"
);
sql.push(
 "UPDATE pi_kb_archetype_curation_v5 SET target_injcode_id=(SELECT entity_id FROM pi_kb_names_v1 n "+
 "WHERE n.entity_type='archetype' AND n.entity_key=pi_kb_archetype_curation_v5.proposed_entity_key) "+
 "WHERE decision='new_archetype';"
);
sql.push(
 "INSERT OR IGNORE INTO pi_kb_lookup_aliases_v4(alias_key,injcode_id,entity_type,alias_rule) "+
 "SELECT phrase,target_injcode_id,'archetype',CASE WHEN decision='new_archetype' "+
 "THEN 'v5_provisional_taxonomy_source_phrase' ELSE 'v5_curated_existing_alias' END "+
 "FROM pi_kb_archetype_curation_v5 "+
 "WHERE decision IN('new_archetype','alias_existing') AND target_injcode_id IS NOT NULL;"
);
const destination=resolve(process.argv[2] || resolve(root,'data','taxonomy-v5-generated.sql'));
writeFileSync(destination,sql.join('\n')+'\n','utf8');
process.stdout.write(JSON.stringify({curated:curation.length,exceptions:exceptions.length,
 patterns:patterns.length,sqlStatements:sql.length,output:destination})+'\n');
