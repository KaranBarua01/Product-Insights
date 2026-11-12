import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateRegistry,classifyChangedPaths,validatePullRequest,validateDraftContract,checkNoDirectDeployment} from './check.mjs';
const registry=JSON.parse(readFileSync(new URL('../../collaboration/workstreams.json',import.meta.url)));
const schema=JSON.parse(readFileSync(new URL('../../contracts/proposals/evidence-to-engineering.v0.schema.json',import.meta.url)));
const fixture=JSON.parse(readFileSync(new URL('../../contracts/proposals/evidence-to-engineering.example.json',import.meta.url)));
const approved=`**Workstream:** PLATFORM
**Primary owner:** @KaranBarua01
**Tracking issue:** #1
- [x] I searched existing code and the capability registry.
- [x] I ran the relevant local tests, or documented limitations.
- [x] I did not add private research or secrets.
- [x] This PR does not claim that AI proposals are validated truth.
- [x] **Shared interface / multi-lane / deployment change:** review requested.
`;
test('one canonical owner and one path per capability',()=>{
  assert.deepEqual(validateRegistry(registry),[]);
  const duplicate=structuredClone(registry);duplicate.capabilities.push({...duplicate.capabilities[0]});
  assert.match(validateRegistry(duplicate).join(' '),/Duplicate/);
});
test('both engineers have separate implementation scopes',()=>{
  const result=classifyChangedPaths(['Scrappers/src/engine.ts','intelligence/manufacturing/process_inference/main.py','contracts/proposals/a.json'],registry);
  assert.deepEqual(result.lanes,['ACQUISITION','MANUFACTURING','INTEGRATION']);
  assert.deepEqual(result.unknown,[]);
});
test('tracked and declared multi-lane PR is permitted',()=>{
  assert.deepEqual(validatePullRequest({body:approved,files:['README.md','.github/workflows/ci.yml','contracts/proposals/a.json'],registry,branch:'chore/parallel-development-handoff'}),[]);
});
test('missing shared review stops overlapping edits',()=>{
  const bad=approved.replace('- [x] **Shared interface','- [ ] **Shared interface');
  assert.match(validatePullRequest({body:bad,files:['Scrappers/src/engine.ts','intelligence/manufacturing/a.py'],registry,branch:'fix/integration'}).join(' '),/shared-change/);
});
test('wrong lane cannot silently claim another owners work',()=>{
  const bad=approved.replace('**Workstream:** PLATFORM','**Workstream:** MANUFACTURING');
  assert.match(validatePullRequest({body:bad,files:['Scrappers/src/engine.ts'],registry,branch:'feat/manufacturing-foo'}).join(' '),/workstream does not own/);
});
test('missing issue and duplication acknowledgment fails',()=>{
  const bad=approved.replace('**Tracking issue:** #1','**Tracking issue:** TBD').replace('- [x] I searched','- [ ] I searched');
  assert.match(validatePullRequest({body:bad,files:['README.md'],registry,branch:'chore/check'}).join(' '),/Tracking issue/);
});
test('proposal has review and source attribution requirements',()=>{
  assert.deepEqual(validateDraftContract(schema,fixture),[]);
  const altered=structuredClone(fixture);altered.components[0].facts[0].reviewStatus='certain';
  assert.match(validateDraftContract(schema,altered).join(' '),/review status/);
});
test('no production deployment or Cloudflare deploy secrets in source CI',()=>{
  assert.deepEqual(checkNoDirectDeployment([{path:'ci.yml',content:'run: npm test'}]),[]);
  assert.match(checkNoDirectDeployment([{path:'deploy.yml',content:'run: npx wrangler deploy'}]).join(' '),/Forbidden/);
  assert.match(checkNoDirectDeployment([{path:'deploy.yml',content:'CLOUDFLARE_API_TOKEN'}]).join(' '),/Forbidden/);
});
