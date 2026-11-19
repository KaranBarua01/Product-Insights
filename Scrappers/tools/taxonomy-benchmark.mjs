#!/usr/bin/env node
/** Fully offline evidence retrieval benchmark. No AI, network or taxonomy writes. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {rankEvidenceTaxonomy} from './taxonomy-retrieval.mjs';
// PowerShell 5.1 may write a UTF-8 BOM even when the JSON itself is valid.
export function parseLocalJson(raw){return JSON.parse(String(raw).replace(/^\uFEFF/,''));}

export function scoreTaxonomyCases(cases,nodes){
  if(!Array.isArray(cases)||!Array.isArray(nodes))throw Error('cases and nodes arrays required');
  const valid=new Set(nodes.map(n=>n.code));
  const summary={cases:0,positiveCases:0,negativeCases:0,top1Hits:0,top3Hits:0,
    positiveAbstentions:0,negativeAbstentions:0,negativeSuggestions:0,
    taxonomyLeavesSearched:nodes.filter(n=>n.level>=2).length,rows:[]};
  for(const item of cases){
    if(!item||typeof item.name!=='string'||typeof item.quote!=='string'||!Object.prototype.hasOwnProperty.call(item,'expectedCode'))
      throw Error('Each case needs a name, quote, and expectedCode (null for abstain)');
    if(item.expectedCode!==null&&!valid.has(item.expectedCode))throw Error('Unknown expectedCode: '+item.expectedCode);
    const started=performance.now(),suggestions=rankEvidenceTaxonomy(item,nodes);
    const row={id:item.id||item.name,expectedCode:item.expectedCode,topCode:suggestions[0]?.code||null,
      candidates:suggestions.map(x=>({code:x.code,score:x.score})),elapsedMs:Number((performance.now()-started).toFixed(2))};
    summary.rows.push(row);summary.cases++;
    if(item.expectedCode===null){summary.negativeCases++;
      if(!suggestions.length)summary.negativeAbstentions++;else summary.negativeSuggestions++;
    }else{summary.positiveCases++;
      if(row.topCode===item.expectedCode)summary.top1Hits++;
      if(suggestions.some(x=>x.code===item.expectedCode))summary.top3Hits++;
      if(!suggestions.length)summary.positiveAbstentions++;
    }
  }
  summary.top1Rate=summary.positiveCases?Number((summary.top1Hits/summary.positiveCases).toFixed(3)):null;
  summary.top3Rate=summary.positiveCases?Number((summary.top3Hits/summary.positiveCases).toFixed(3)):null;
  summary.negativeAbstentionRate=summary.negativeCases?Number((summary.negativeAbstentions/summary.negativeCases).toFixed(3)):null;
  return summary;
}
/** Unlabeled local retrieval probe: never masquerades as benchmark accuracy. */
export function probeTaxonomyRows(rows,nodes){
  if(!Array.isArray(rows)||!rows.length||!Array.isArray(nodes)||!nodes.length)
    throw Error('Need non-empty evidence rows and installed taxonomy nodes');
  const results=rows.map((row,index)=>{
    const name=String(row?.family||row?.name||'').trim(),quote=String(row?.evidence||row?.quote||'').trim();
    if(!name||!quote)throw Error('Evidence row '+index+' is missing a product name or source quotation');
    const candidates=rankEvidenceTaxonomy({name,quote},nodes);
    return {product:name,sourceUrl:String(row.sourceUrl||''),status:candidates.length?'candidate_requires_review':'abstained_unresolved',
      topCategory:candidates[0]?.label||null,topCode:candidates[0]?.code||null,
      score:candidates[0]?.score??null,candidates};
  });
  return {status:'unlabeled_retrieval_probe_not_accuracy',taxonomyNodes:nodes.length,
    searchableNodes:nodes.filter(n=>n.level>=2).length,products:results.length,
    candidateProducts:results.filter(x=>x.candidates.length).length,
    abstentions:results.filter(x=>!x.candidates.length).length,results};
}
async function main(){
  const argv=process.argv.slice(2),get=key=>{const i=argv.indexOf(key);return i>=0?argv[i+1]:null;};
  if(argv.includes('--help')){console.log('Usage: node tools/taxonomy-benchmark.mjs [--cases labeled-cases.json] [--taxonomy local-explorer.html] [--out local.json] OR --taxonomy local-explorer.html --evidence local-evidence.json --out local-probe.json');return;}
  const evidencePath=get('--evidence'),privatePath=get('--taxonomy');
  if(evidencePath){
    if(!privatePath||get('--cases'))throw Error('--evidence requires --taxonomy and must not be combined with --cases');
    const nodes=(await import('./research-planner.mjs')).parseTaxonomy(await readFile(privatePath,'utf8'));
    const loaded=parseLocalJson(await readFile(evidencePath,'utf8'));
    const result=probeTaxonomyRows(Array.isArray(loaded)?loaded:loaded.rows,nodes);
    const output=get('--out');
    if(output){await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');}
    console.log('Unlabeled retrieval probe ONLY: no classification accuracy or taxonomy approval asserted.');
    console.log('Taxonomy nodes: '+result.taxonomyNodes+'; searchable L2/L3: '+result.searchableNodes);
    console.table(result.results.map(x=>({Product:x.product,'Top Category':x.topCategory||'NONE','Top Score':x.score??'-',
      Candidates:x.candidates.length,Status:x.status})));
    if(output)console.log('Saved: '+output);
    return;
  }
  const defaultCases=resolve(dirname(fileURLToPath(import.meta.url)),'../benchmark/taxonomy-fixtures.synthetic.json');
  const casesPath=get('--cases')||defaultCases,caseFile=parseLocalJson(await readFile(casesPath,'utf8'));
  if(privatePath&&!get('--cases'))throw Error('--taxonomy requires your own locally labeled --cases (demo codes differ from private IDs)');
  const nodes=privatePath?(await import('./research-planner.mjs')).parseTaxonomy(await readFile(privatePath,'utf8')):caseFile.nodes;
  const result=scoreTaxonomyCases(caseFile.cases,nodes);
  const output=get('--out');
  if(output){await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
