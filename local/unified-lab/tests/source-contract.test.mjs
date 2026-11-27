import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const read=rel=>readFileSync(join(ROOT,rel),'utf8');

test('source-only GitHub import excludes runtime database, user output and tokens',()=>{
 for(const rel of ['data/knowledge.sqlite','data/manifest.json','local-data','results','node_modules','.env','secrets'])
  assert.equal(existsSync(join(ROOT,rel)),false,'must not publish '+rel);
});
test('source includes acquired + pattern pipeline, local agent and read-only update status',()=>{
 for(const rel of ['start.mjs','start.ps1','app/server.mjs','app/acquisition.mjs','app/queue-agent.mjs','app/update-status.mjs','app/app.js','app/index.html','data/schema.sql','tests/update-status.test.mjs'])
  assert.equal(existsSync(join(ROOT,rel)),true,rel);
 assert.match(read('app/server.mjs'),/local_update:readLocalUpdateStatus\(root\)/);
 assert.match(read('app/app.js'),/updateStatus/);
 assert.match(read('app/index.html'),/id="updateStatus"/);
 assert.match(read('start.mjs'),/startUpdateWatcher\(root\)/);
 assert.match(read('app/queue-agent.mjs'),/update_status/);
 assert.match(read('app/queue-agent.mjs'),/update_stage/);
});
test('read-only update status cannot replace research or AI providers',()=>{
 const s=read('app/update-status.mjs');
 assert.doesNotMatch(s,/writeFile|execFile|spawn|eval\(|ollama|openai|cloudflare|CLOUDFLARE_API_TOKEN/i);
 const server=read('app/server.mjs');
 assert.match(server,/\/api\/status/);
});
