#!/usr/bin/env node
/** Local-only environment and taxonomy verification for a new isolated checkout. */
import {loadInstalledTaxonomy} from './research-taxonomy-store.mjs';
import {loadOemProcessReference} from './oem-process-reference.mjs';
import {readApprovedCompanies} from './approved-company-sites.mjs';
async function main(){
 const taxonomy=await loadInstalledTaxonomy();
 if(!taxonomy||taxonomy.nodes.length!==1213||taxonomy.manifest.totalNodes!==1213)
   throw Error('Original local taxonomy not installed or node count mismatch: expected 1,213.');
 const process=await loadOemProcessReference();
 if(!process||process.counts.nodes!==1213||process.counts.processes!==220||
    process.counts.links!==10388||process.counts.leaves!==1004)
   throw Error('Local code reference missing or invalid: expected 1,213 nodes, 220 processes, 10,388 draft links.');
 const approvals=await readApprovedCompanies();
 console.log(JSON.stringify({ok:true,foundation:'pi-code-foundation/v1',
   taxonomyNodes:taxonomy.nodes.length,processes:process.counts.processes,
   processLinks:process.counts.links,approvedAdditionalHosts:approvals.hosts.length,
   privateTaxonomy:'loaded_from_gitignored_local_json',osModified:false},null,2));
}
main().catch(e=>{console.error('Local foundation verification failed:',String(e?.message||e));
 process.exitCode=1;});
