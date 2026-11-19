#!/usr/bin/env node
/**
 * Local, human-adjudicated source-claim precision review.
 * This script NEVER fetches websites, changes the extractor or auto-labels claims.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreHumanReviews} from './universal-validation.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BASE=resolve(ROOT,'local-data/pi-local-agent/outputs');
function inPrivateOutputs(value){
  const dest=resolve(ROOT,value);
  const rel=relative(BASE,dest);
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||rel==='')
    throw Error('Human review file must be within local-data/pi-local-agent/outputs');
  if(!/\.csv$/i.test(dest)&&!/\.json$/i.test(dest))throw Error('Expected CSV or JSON local review file');
  return dest;
}
async function main(argv=process.argv.slice(2)){
  const flags={};
  for(let i=0;i<argv.length;i+=2){
    if(!['--template','--reviewed','--out'].includes(argv[i])||!argv[i+1])
      throw Error('Usage: --template PRIVATE.csv --reviewed EDITED_PRIVATE.csv [--out SCORE.json]');
    flags[argv[i]]=inPrivateOutputs(argv[i+1]);
  }
  if(!flags['--template']||!flags['--reviewed']||
    flags['--template']===flags['--reviewed'])
    throw Error('Original frozen template and reviewed copy must be separate files');
  const [template,reviewed]=await Promise.all([
    readFile(flags['--template'],'utf8'),readFile(flags['--reviewed'],'utf8')]);
  const score=scoreHumanReviews(reviewed,template);
  const json=JSON.stringify({schemaVersion:'pi-human-claim-review/v1',
    generatedAt:new Date().toISOString(),score},null,2)+'\n';
  if(flags['--out']){
    if(!flags['--out'].endsWith('.json'))throw Error('--out must be a JSON file');
    await writeFile(flags['--out'],json,{flag:'wx'});
  }
  console.log(json);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1;});
