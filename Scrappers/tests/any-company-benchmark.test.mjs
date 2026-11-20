import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {approveCompanyUrl,readApprovedCompanies,revokeCompanyHost} from '../tools/approved-company-sites.mjs';
import {readSiteList,summarizeLabReport} from '../tools/test-diverse-company-websites.mjs';

test('approves an arbitrary new public domain only after laptop DNS preflight, not a fixed six-site list',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-approval-')),filePath=join(dir,'approved.json');
 const check=async host=>{assert.equal(host,'www.hammfg.com');return ['1.2.3.4'];};
 const first=await approveCompanyUrl('https://www.hammfg.com/',{filePath,dnsCheck:check});
 assert.equal(first.added,true);assert.equal(first.host,'hammfg.com');
 assert.equal(first.publicAddressCount,1);
 const second=await approveCompanyUrl('https://www.hammfg.com/',{filePath,dnsCheck:check});
 assert.equal(second.added,false);
 const after=await readApprovedCompanies({filePath});
 assert.deepEqual(after.hosts,['hammfg.com']);
 assert.ok(!JSON.stringify(after).includes('token'));
 const removed=await revokeCompanyHost('hammfg.com',{filePath});
 assert.equal(removed.removed,true);
 assert.deepEqual((await readApprovedCompanies({filePath})).hosts,[]);
});
test('rejects private DNS results and never writes an approval',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-approval-')),filePath=join(dir,'approved.json');
 await assert.rejects(()=>approveCompanyUrl('https://www.hammfg.com/',{
   filePath,dnsCheck:()=>{throw Error('DNS resolved to private network');}}),/private network/);
 assert.equal((await readApprovedCompanies({filePath})).hosts.length,0);
 await assert.rejects(()=>approveCompanyUrl('https://127.0.0.1/',{
   filePath,dnsCheck:()=>['8.8.8.8']}),/Only public DNS/);
 assert.equal((await readApprovedCompanies({filePath})).hosts.length,0);
});
test('site-list reader accepts diverse public HTTPS companies and deduplicates by exact canonical host',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-benchmark-')),file=join(dir,'sites.txt');
 await writeFile(file,'# varied companies\nhttps://www.hammfg.com/\nhttps://www.igus.com/\n'+
   'https://hammfg.com/products\nhttps://www.ricelake.com/\n');
 assert.deepEqual((await readSiteList(file,{max:2})).map(x=>new URL(x).hostname),
   ['www.hammfg.com','www.igus.com']);
 assert.equal((await readSiteList(file,{max:6})).length,3);
 await writeFile(file,'https://127.0.0.1/\n');
 await assert.rejects(()=>readSiteList(file),/Only public DNS/);
});
test('benchmark report records real AI coverage, missing mappings, page failures and edition changes',()=>{
 const site='https://www.hammfg.com/',now='2026-11-20T17:00:00.000Z';
 const run={ok:true,report:{status:'sampled',
   coverage:{visitedPages:3,discoveredLeads:12},
   pages:[{url:site,status:'completed',strategy:'S01'},
     {url:site+'products',status:'blocked',reason:'Robots',strategy:'S02'},
     {url:site+'enclosures',status:'partial',strategy:'S01'}],
   productIntelligence:{products:[{name:'Enclosure X',
     components:[{value:'mounting bracket'}],materials:[{value:'steel'}]}]},
   researchGraph:{counts:{products:1,observedParts:1,aiHypothesisParts:1,
     processHypotheses:3,taxonomyMappings:0,unmappedParts:1,unmappedProducts:1}},
   lab:{ollama:{status:'enriched',model:'qwen3:4b-instruct',productsReviewed:1,
     acceptedClaims:2,rejectedClaims:1}},
   relationshipAi:{status:'hypotheses_proposed',hypotheses:1},
   warnings:['Robots blocked product details'] }};
 const r=summarizeLabReport(site,run,{pages:3,startedAt:now,finishedAt:now,
   editionBefore:{version:2},editionAfter:{version:3}});
 assert.equal(r.products,1);assert.equal(r.completedPages,2);
 assert.equal(r.sourceGraph.processHypotheses,3);assert.equal(r.sourceGraph.taxonomyMappings,0);
 assert.ok(r.issues.includes('no_taxonomy_mappings'));
 assert.ok(!r.issues.includes('working_edition_did_not_advance'));
 assert.equal(r.laptopAi.acceptedClaims,2);assert.equal(r.laptopAi.inferredPartProposals,1);
 assert.equal(r.accessWarnings.length,1);
});
