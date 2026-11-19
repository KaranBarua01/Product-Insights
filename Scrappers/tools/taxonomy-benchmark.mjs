#!/usr/bin/env node
/** Fully offline evidence retrieval benchmark. No AI, network or taxonomy writes. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {rankEvidenceTaxonomy} from './taxonomy-retrieval.mjs';

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
async function main(){
  const argv=process.argv.slice(2),get=key=>{const i=argv.indexOf(key);return i>=0?argv[i+1]:null;};
  if(argv.includes('--help')){console.log('Usage: node tools/taxonomy-benchmark.mjs [--cases benchmark/taxonomy-fixtures.synthetic.json] [--taxonomy local-explorer.html] [--out qa-results/taxonomy.json]');return;}
  const defaultCases=resolve(dirname(fileURLToPath(import.meta.url)),'../benchmark/taxonomy-fixtures.synthetic.json');
  const casesPath=get('--cases')||defaultCases,caseFile=JSON.parse(await readFile(casesPath,'utf8'));
  const privatePath=get('--taxonomy');
  if(privatePath&&!get('--cases'))throw Error('--taxonomy requires your own locally labeled --cases (demo codes differ from private IDs)');
  const nodes=privatePath?(await import('./research-planner.mjs')).parseTaxonomy(await readFile(privatePath,'utf8')):caseFile.nodes;
  const result=scoreTaxonomyCases(caseFile.cases,nodes);
  const output=get('--out');
  if(output){await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
