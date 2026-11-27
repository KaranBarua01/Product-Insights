/** Read-only localhost updater status. No AI-provider dependency or secrets. */
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const RELEASE=/^[a-z0-9][a-z0-9._-]{0,47}$/;
function releaseId(dir,file){
 try{
  const raw=JSON.parse(readFileSync(join(dir,file),'utf8'));
  return typeof raw?.releaseId==='string'&&RELEASE.test(raw.releaseId)?raw.releaseId:null;
 }catch{return null;}
}
export function readLocalUpdateStatus(root){
 const dir=join(root,'local-data','pi-updates');
 const applied=releaseId(dir,'installed.json');
 const staged=releaseId(dir,'staged.json');
 return Object.freeze({
  installed:applied||'legacy-local',
  staged,
  pending:!!staged&&staged!==applied,
  recoveryPending:existsSync(join(dir,'journal.json')),
 });
}
