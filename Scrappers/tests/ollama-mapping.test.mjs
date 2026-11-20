import test from 'node:test';
import assert from 'node:assert/strict';
import {probeOllama,validateSourceProducts,enrichWithLocalOllama,mergeOllamaProducts} from '../tools/ollama-mapping.mjs';

const url='https://1up-usa.com/product/heavy-duty';
const page={url,sourceUrl:url,status:'completed',content:{title:'Heavy Duty Bike Rack',headings:['Heavy Duty Bike Rack'],
  text:'Heavy Duty Bike Rack. This rack is made from aluminum. Includes mounting brackets.'}};
const extraction={products:[{name:'Heavy Duty Bike Rack',sourceUrl:url,quote:'Heavy Duty Bike Rack',
  kind:'product_model',category:'Bike racks',
  components:[{name:'mounting brackets',quote:'Includes mounting brackets.'}],
  materials:[{name:'aluminum',quote:'This rack is made from aluminum.'}]}]};
const cpuReply={productName:'Heavy Duty Bike Rack',sourceQuote:'Heavy Duty Bike Rack',
  components:[{name:'mounting brackets',quote:'Includes mounting brackets.'}],
  materials:[{name:'aluminum',quote:'This rack is made from aluminum.'}]};
function mockApi({product=cpuReply,matches={matches:[]},models=[{name:'qwen3:4b-instruct',size:2500000000}]}={}){
  const seen=[];
  const fetcher=async (address,opts={})=>{
    assert.ok(address.startsWith('http://127.0.0.1:11434/'),'Only localhost is allowed');
    const type=address.endsWith('api/tags')?'tags':'chat';
    const output=type==='tags'?{models}:{message:{content:JSON.stringify(seen.filter(x=>x.type==='chat').length?matches:product)}};
    seen.push({type,address,opts});
    return {ok:true,text:async()=>JSON.stringify(output)};
  };
  return {fetcher,seen};
}
test('finds the installed model on loopback',async()=>{
  const {fetcher,seen}=mockApi();
  const p=await probeOllama({fetcher});
  assert.equal(p.status,'ready');
  assert.equal(p.model,'qwen3:4b-instruct');
  assert.equal(seen.length,1);
});
test('rejects invented products, unrelated domains and unsupported materials',()=>{
  const pages=[{url,sourceText:'Heavy Duty Bike Rack. Includes mounting brackets.'}];
  const validated=validateSourceProducts({products:[
    {...extraction.products[0],sourceUrl:'https://unrelated.example/p'},
    {...extraction.products[0],name:'Imaginary Bike'},
    {...extraction.products[0],materials:[{name:'titanium',quote:'Made of titanium.'}]}
  ]},pages);
  assert.equal(validated.length,1);
  assert.equal(validated[0].components.length,1);
  assert.equal(validated[0].materials.length,0);
});
test('extracts actual product evidence and proposes only a listed taxonomy code',async()=>{
  const {fetcher,seen}=mockApi({matches:{matches:[{name:'Heavy Duty Bike Rack',sourceUrl:url,code:'L3-RACK'}]}});
  const result=await enrichWithLocalOllama({rootUrl:'https://1up-usa.com/',rawPages:[page],fetcher,
    taxonomyNodes:[{code:'L3-RACK',label:'Cargo racks',level:3,path:'Transport > Cargo racks'}]});
  assert.equal(result.status,'completed');
  assert.equal(result.products.length,1);
  assert.equal(result.products[0].materials[0].material,'aluminum');
  assert.equal(result.products[0].components[0].component,'mounting brackets');
  assert.equal(result.products[0].taxonomy.suggestions[0].code,'L3-RACK');
  assert.equal(seen.filter(x=>x.type==='chat').length,2);
  const extractionRequest=JSON.parse(seen.filter(x=>x.type==='chat')[0].opts.body);
  const body=JSON.parse(extractionRequest.messages[1].content);
  assert.equal(body.pageText.includes('aluminum'),true);
  assert.ok(body.pageText.length<=2400);
  assert.equal(extractionRequest.options.num_predict,300);
  assert.equal(extractionRequest.messages[0].content.includes('ONE product page'),true);
  assert.equal(result.pagesAnalyzed,1);

  const merged=mergeOllamaProducts({coverage:{products:0},products:[]},result);
  assert.equal(merged.coverage.products,1);
});
test('abstains when an AI mapping code is not among retrieved nodes',async()=>{
  const {fetcher}=mockApi({matches:{matches:[{name:'Heavy Duty Bike Rack',sourceUrl:url,code:'FAKE-CODE'}]}});
  const output=await enrichWithLocalOllama({rootUrl:'https://1up-usa.com/',rawPages:[page],fetcher,
    taxonomyNodes:[{code:'L3-RACK',label:'Cargo racks',level:3,path:'Transport > Cargo racks'}]});
  assert.equal(output.products[0].taxonomy.status,'gap_or_insufficient_evidence');
});
test('gracefully falls back when Ollama is not running',async()=>{
  const output=await enrichWithLocalOllama({rootUrl:'https://1up-usa.com/',rawPages:[page],
    fetcher:async()=>{throw Error('ECONNREFUSED')}});
  assert.equal(output.status,'unavailable');
  assert.deepEqual(output.products,[]);
});
test('CPU inference sends one bounded product page even if source collection has three large pages',async()=>{
  const candidates=[
    {...page,content:{...page.content,text:page.content.text.repeat(100)}},
    {...page,url:'https://1up-usa.com/product/super-duty',sourceUrl:'https://1up-usa.com/product/super-duty',
      content:{title:'Super Duty Bike Rack',headings:['Super Duty Bike Rack'],text:'Super Duty Bike Rack '.repeat(200)}},
    {...page,url:'https://1up-usa.com/product/quik-rack',sourceUrl:'https://1up-usa.com/product/quik-rack',
      content:{title:'Quik Rack',headings:['Quik Rack'],text:'Quik Rack '.repeat(200)}}
  ];
  const {fetcher,seen}=mockApi();
  const result=await enrichWithLocalOllama({rootUrl:'https://1up-usa.com/',rawPages:candidates,fetcher});
  assert.equal(result.pagesAnalyzed,1);
  assert.equal(result.status,'completed');
  const chats=seen.filter(x=>x.type==='chat');
  assert.equal(chats.length,1);
  const request=JSON.parse(chats[0].opts.body);
  const input=JSON.parse(request.messages[1].content);
  assert.ok(input.pageText.length<=2400);
  assert.ok(!('pages' in input));
});
