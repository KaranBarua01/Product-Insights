#!/usr/bin/env node
/** Interactive local operator approval; never a remotely callable bridge action. */
import {createInterface} from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import {approveCompanyUrl,revokeCompanyHost,readApprovedCompanies} from './approved-company-sites.mjs';
const args=process.argv.slice(2);
async function main(){
 const operation=args[0]||'interactive';
 if(operation==='--list'){
   const data=await readApprovedCompanies();
   console.log(data.hosts.length?data.hosts.map((x,i)=>(i+1)+'. '+x).join('\n'):'No added public company hosts.');
   return;
 }
 if(operation==='--remove'){
   if(!args[1])throw Error('Usage: node tools/approve-company.mjs --remove company.com');
   const done=await revokeCompanyHost(args[1]);
   console.log(done.removed?'Removed local approval for '+done.host:'No additional approval existed for '+done.host);
   console.log('The bridge will synchronize the new host list automatically.');
   return;
 }
 let url=args[0]==='--add'?args[1]:args[0];
 if(!url||url==='interactive'){
   const io=createInterface({input,output});
   try{url=(await io.question('Enter HTTPS public company URL to approve: ')).trim();}
   finally{io.close();}
 }
 if(!url)throw Error('No company URL entered');
 const done=await approveCompanyUrl(url);
 console.log(done.added?'APPROVED NEW COMPANY: '+done.host:'ALREADY APPROVED: '+done.host);
 console.log('Public DNS preflight passed for '+done.publicAddressCount+' address(es).');
 console.log('The running bridge will synchronize automatically within a few polling cycles.');
 console.log('Open Cloudflare Live Tests and enter '+url+'.');
}
main().catch(e=>{console.error('Approval refused:',String(e?.message||e));process.exitCode=1;});
