import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {PIN} from './app/acquisition.mjs';
const lock=JSON.parse(readFileSync(new URL('./runtime-lock.json',import.meta.url),'utf8'));
if(lock.revision!==PIN||!process.argv[2])throw Error('Runtime lock or source path missing');
const dir=resolve(process.argv[2]);
for(const [file,expected] of Object.entries(lock.gitBlobSha1)){
 const bytes=readFileSync(join(dir,file));
 const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 if(sha!==expected)throw Error('Pinned source verification failed: '+file);
}
console.log('Verified '+Object.keys(lock.gitBlobSha1).length+' pinned source files against their Git blob IDs.');
