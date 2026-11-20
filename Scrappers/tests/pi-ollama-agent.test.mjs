import test from 'node:test';
import assert from 'node:assert/strict';
import {health,run1up,fixedOutputPath,summarize1up,JOB_SCHEMA} from '../tools/pi-local-agent/ollama-job.mjs';

function mockOllama({installed=true,reply='{"ok":true}'}={}){
  const requests=[];
  const fetcher=async(url,options={})=>{
    assert.ok(url.startsWith('http://127.0.0.1:11434/'),'only local Ollama');
    requests.push({url,options});
    const data=url.endsWith('/api/tags')
      ? {models:installed?[{name:'qwen3:4b-instruct',size:2500000000}]:[]}
      : {message:{content:reply}};
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  return {fetcher,requests};
}
test('health requires a real local model JSON inference, not only /api/tags',async()=>{
  const {fetcher,requests}=mockOllama();
  const result=await health({fetcher});
  assert.equal(result.schemaVersion,JOB_SCHEMA);
  assert.equal(result.action,'ollama_health');
  assert.equal(result.status,'completed');
  assert.equal(result.check,'inference_passed');
  assert.equal(result.localhostOnly,true);
  assert.equal(requests.length,2);
  const input=JSON.parse(requests[1].options.body);
  assert.equal(input.model,'qwen3:4b-instruct');
  assert.equal(input.stream,false);
  assert.equal(input.options.temperature,0);
});
test('health fails closed when the model is missing or inference is invalid',async()=>{
  const missing=await health({fetcher:mockOllama({installed:false}).fetcher});
  assert.equal(missing.status,'unavailable');
  const wrong=await health({fetcher:mockOllama({reply:'{"ok":false}'}).fetcher});
  assert.equal(wrong.status,'failed');
  assert.equal(wrong.check,'invalid_inference_reply');
});
test('1UP job does not contact a website unless the fixed model is ready',async()=>{
  const {fetcher,requests}=mockOllama({installed:false});
  const output=await run1up({fetcher});
  assert.equal(output.summary.status,'unavailable');
  assert.equal(requests.length,1);
});
test('fixed output paths disallow traversal, arbitrary paths and unsupported actions',()=>{
  assert.match(fixedOutputPath('ollama_health','local-data/pi-local-agent/outputs/health_job_123-ollama_health.json'),
    /health_job_123-ollama_health\.json$/);
  assert.match(fixedOutputPath('ollama_health','local-data\\pi-local-agent\\outputs\\health_job_123-ollama_health.json'),
    /health_job_123-ollama_health\.json$/);
  for(const p of ['../../outside.json','local-data/pi-local-agent/outputs/not.txt',
    'local-data/pi-local-agent/outputs/short-ollama_health.json',
    'local-data/pi-local-agent/outputs/job_12345678-ollama_1up.json',
    '/tmp/job_12345678-ollama_health.json'])
    assert.throws(()=>fixedOutputPath('ollama_health',p),/Invalid|fixed|Output/);
  assert.throws(()=>fixedOutputPath('powershell','local-data/pi-local-agent/outputs/job_12345678-powershell.json'),/Unknown/);
});
test('summary preserves source evidence without inventing processes or company ownership',()=>{
  const source='https://1up-usa.com/products/super-duty';
  const result=summarize1up({
    research:{status:'sampled',pages:[{url:source,status:'completed',strategy:'S01',textChars:3000,
      title:'Super Duty Rack'}]},
    reference:{nodes:[{code:'T1'}],manifest:{nodeHash:'a'.repeat(64)}},
    model:{status:'completed',model:'qwen3:4b-instruct',pagesAnalyzed:1,
      products:[{name:'Super Duty Rack'}]},
    productIntelligence:{products:[
      {name:'Super Duty Rack',sourceUrl:source,extractionMethod:'local_ollama_exact_source_quote',
        evidence:[{quote:'Super Duty Rack'}],
        materials:[{material:'aluminum',evidence:{quote:'made from aluminum'}}],
        components:[{component:'mounting bracket',evidence:{quote:'includes mounting bracket'}}],
        taxonomy:{status:'candidate_requires_review',suggestions:[{code:'T1',label:'Bike racks'}]}},
      {name:'Offdomain',sourceUrl:'https://unrelated.example.com/p',evidence:[{quote:'Offdomain'}]}
    ]}
  });
  assert.equal(result.schemaVersion,JOB_SCHEMA);
  assert.equal(result.acquisition.pagesVisited,1);
  assert.equal(result.output.productCount,1);
  assert.equal(result.output.products.length,1);
  assert.equal(result.output.localAiProducts,1);
  assert.equal(result.taxonomy.masterChanged,false);
  assert.equal(result.output.products[0].reviewStatus,'unverified_source_candidate');
  assert.equal(result.output.products[0].materials[0].name,'aluminum');
  assert.equal(result.output.products[0].taxonomy.suggestions[0].code,'T1');
  assert.match(result.quality,/not_accuracy/);
  assert.ok(!JSON.stringify(result).includes('in_house_capabilities'));
});
