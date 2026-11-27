#!/usr/bin/env node
/**
 * CI-only real GitHub end-to-end canary. No localhost, tokens or user data.
 * Fetches pinned public commit, activates a harmless text file and rolls back.
 */
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stage,activate,rollback,status,validateManifest} from './core.mjs';
const here=fileURLToPath(new URL('./',import.meta.url));
const channel=resolve(here,'../../../local/unified-lab/channels/stable.json');
const manifest=validateManifest(JSON.parse(await readFile(channel,'utf8')));
if(manifest.files.length!==1||manifest.files[0].path!=='updater/release-marker.txt'||manifest.files[0].fromSha256!==null)
 throw Error('Canary must install one inert new text file');
const root=await mkdtemp(join(tmpdir(),'pi-gh-e2e-'));
try{
 const s=await stage(root,{manifest});
 if(s.status!=='staged')throw Error('Canary staging failed');
 const a=await activate(root,{offline:async()=>true,smoke:async()=>{}});
 if(a.status!=='activated')throw Error('Canary activation failed');
 const text=await readFile(join(root,'updater','release-marker.txt'),'utf8');
 if(!text.includes('Provider: agnostic')||!text.includes('no application or database changes'))throw Error('Downloaded canary content unexpected');
 const state=await status(root);
 if(state.installed?.releaseId!==manifest.releaseId)throw Error('Installed release not recorded');
 const b=await rollback(root,{offline:async()=>true});
 if(b.status!=='rolled_back')throw Error('Canary rollback failed');
 const after=await status(root);
 if(after.installed!==null)throw Error('Canary rollback did not restore original version');
 console.log('PASS: pinned real GitHub download, SHA-256 verify, stage, activate and rollback');
}finally{await rm(root,{recursive:true,force:true})}
