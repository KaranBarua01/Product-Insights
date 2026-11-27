import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createPinnedFetcher} from './pinned-fetch.mjs';
const here=dirname(fileURLToPath(import.meta.url)),manifestBytes=await readFile(join(here,'failed34.json'));
const manifest=JSON.parse(manifestBytes);
const [sourceRoot,output]=process.argv.slice(2);
if(!sourceRoot||!output)throw Error('Source root and fresh output directory required');
if(manifest.sourceCommit!=='89ec9c91706396c00d1b34e24d5a3f1bf58742ae'||manifest.sites.length!==34||new Set(manifest.sites.map(s=>s.id)).size!==34||manifest.sites.some(s=>s.baseline.usable!==0)||manifest.sites.filter(s=>s.group==='technical_failure').length!==15||manifest.maxPages!==50||manifest.networkRequestLimit!==360||manifest.byteLimit!==67108864)throw Error('Cohort or budget mismatch');
const pi=resolve(sourceRoot,'Scrappers');
const {extract}=await import(pathToFileURL(join(pi,'dist/engine.js')));
const {runResearchV3}=await import(pathToFileURL(join(pi,'tools/research-v3.mjs')));
const sites=[...manifest.sites].sort((a,b)=>Number(a.group==='policy_recheck')-Number(b.group==='policy_recheck')||a.id.localeCompare(b.id));
const dir=resolve(output);await mkdir(dir,{recursive:false});
const header={schemaVersion:'pi-failed-cohort-result/v1',sourceCommit:manifest.sourceCommit,manifestHash:createHash('sha256').update(manifestBytes).digest('hex'),baselineIssue:63,runner:'operator-local',pageCeiling:50,requestCeiling:360,byteCeiling:67108864,browser:false,ocr:false,largePdf:false,patterns:false,network:'DNS-pinned same-origin HTTPS; identity encoding; robots fail closed',comparison:'Exploratory recovery test on operator PC, not strict v0.8 A/B: transport, engine, evidence definitions and website state can differ.',expectedSites:34,startedAt:new Date().toISOString()};
const norm=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const clip=(s,n=300)=>String(s??'').replace(/\s+/g,' ').slice(0,n);
const rows=[];
async function save(name,data){const path=join(dir,name);await writeFile(path+'.tmp',JSON.stringify(data,null,2)+'\n');await rename(path+'.tmp',path);}
async function checkpoint(){const totals={finished:rows.length,completed:rows.filter(r=>r.executionStatus==='completed').length,failedExecution:rows.filter(r=>r.executionStatus!=='completed').length,provisionalRecovered:rows.filter(r=>r.outcome==='provisional_recovery').length,someEvidence:rows.filter(r=>r.outcome==='some_evidence_review_required').length,stillNoEvidence:rows.filter(r=>r.outcome==='still_no_accepted_evidence').length};await save('summary.json',{...header,updatedAt:new Date().toISOString(),totals,rows});return totals;}
await checkpoint();
for(const s of sites){
 const start=Date.now(),deadline=start+720000,host=new URL(s.url).hostname;
 const transport=createPinnedFetcher(host,{maxRequests:360,maxBytes:67108864,deadline});
 let hardStop='',raw=[];
 let row={id:s.id,company:s.company,url:s.url,group:s.group,baseline:s.baseline,executionStatus:'failed'};
 console.log(`[${rows.length+1}/34] ${s.company} (${s.group})`);
 try{
   const report=await runResearchV3({url:s.url,maxPages:50,delayMs:350,shouldContinue:()=>!hardStop&&transport.canContinue(),
     extractPage:async target=>{
       const r=await extract({url:target,mode:'auto',maxPdfPages:15},{fetcher:transport.fetcher},{allowedHosts:[host],timeoutMs:9000,maxHtmlPages:1,maxBytesHtml:1250000,maxBytesPdf:3000000,allowLargePdf:false},'none');
       if(r.status==='blocked'&&/\bHTTP (?:401|403|429|503)\b|access challenge|interstitial|\[robots_denied\]|\[robots_unavailable\]|\[redirect_policy\]/i.test(r.reason))hardStop=r.reason.includes('429')?'rate_limited':'policy_stop';
       return r;
     },onEvidence:r=>raw.push({url:r.sourceUrl,text:r.content?.text||'',pdfPages:r.content?.pdfPages||[]})});
   const q=report.evidenceQuality,coverage=report.coverage;
   if(!q||!coverage)throw Error('Expected Phase 4 evidence-quality report is missing');
   const sources=raw.map(p=>norm([p.text,...p.pdfPages.map(x=>x.text)].join('\n')));
   const selected=report.pages.filter(p=>p.quality?.accepted).flatMap(p=>(p.evidenceWindows||[]).map(w=>norm(w.text)));
   const anchors=s.baseline.anchors.map(a=>({phrase:a.phrase,inNativeText:sources.some(x=>x.includes(norm(a.phrase))),inSelectedEvidence:selected.some(x=>x.includes(norm(a.phrase)))}));
   const hits=anchors.filter(a=>a.inSelectedEvidence).length,stopReason=hardStop||transport.stopReason()||coverage.stopReason;
   const accepted=q.counts.accepted,attempted=coverage.visitedPages,relevant=q.counts.relevant;
   const outcome=relevant>0&&attempted>0&&accepted/attempted>=0.5&&hits>0?'provisional_recovery':accepted>0?'some_evidence_review_required':'still_no_accepted_evidence';
   row={...row,executionStatus:'completed',outcome,attempted,retrieved:q.counts.retrieved,accepted,relevant,productCandidates:q.distinctProductCandidates,score:q.score,missingDimensions:q.missingDimensions,anchors,selectedAnchorHits:hits,remainingLeads:coverage.remainingLeads,stopReason,network:transport.stats(),elapsedMs:Date.now()-start,seedAccessAttempts:report.seedAccessAttempts,pages:report.pages.map(p=>({url:p.url,status:p.status,reason:clip(p.reason),pageKind:p.pageKind,quality:p.quality?.classification,score:p.quality?.score})),limitations:header.comparison};
   await save(s.id+'.json',{...header,row,report});
 }catch(e){row={...row,error:clip(e?.message||e,600),network:transport.stats(),elapsedMs:Date.now()-start};await save(s.id+'.json',{...header,row});}
 rows.push(row);await checkpoint();
 console.log(JSON.stringify({id:row.id,outcome:row.outcome||row.executionStatus,accepted:row.accepted,products:row.productCandidates,stop:row.stopReason,error:row.error}));
}
const totals=await checkpoint();console.log('COMPLETED '+JSON.stringify(totals));console.log('Results: '+dir);
if(totals.failedExecution)process.exitCode=2;
