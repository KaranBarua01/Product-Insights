import test from 'node:test';
import assert from 'node:assert/strict';
import {stage2Config,callStage2} from '../tools/research-stage2.mjs';
import {runResearch} from '../tools/research-planner.mjs';
import {selectJsSources,buildJsProfile} from '../dist/js-profile.js';
import {handleStage2Request} from '../dist/stage2-routes.js';
import {identifyCompanyRole} from '../tools/research-intelligence.mjs';

test('Stage 2 transport supports explicit loopback HTTP development without permitting remote plaintext endpoints',async()=>{
  for(const address of ['http://127.0.0.1:8788','http://localhost:8788','http://[::1]:8788']){
    const config=stage2Config({RESEARCH_LAB_AI_URL:address,RESEARCH_LAB_AI_TOKEN:'disposable-test-token'});
    assert.equal(config.configured,true);
    let requested;
    await callStage2('plan',{rootUrl:'https://1up-usa.com/',links:[]},{config,fetcher:async(url)=>{
      requested=url;return Response.json({schemaVersion:'insidejob-stage2/1',status:'no_links'});
    }});
    assert.equal(requested,address+'/api/stage2/plan');
  }
  for(const address of ['http://example.org','http://127.0.0.1.example.org:8788','http://192.168.1.2:8788','http://user:password@localhost:8788','http://localhost:8788?token=secret']){
    assert.throws(()=>stage2Config({RESEARCH_LAB_AI_URL:address,RESEARCH_LAB_AI_TOKEN:'disposable-test-token'}));
  }
});

test('analyze transport allows two sequential model calls instead of aborting a valid 38-second response',async t=>{
  const timeout=AbortSignal.timeout.bind(AbortSignal);
  let allocated;
  t.mock.method(AbortSignal,'timeout',ms=>{allocated=ms;return timeout(ms)});
  await callStage2('analyze',{}, {config:{configured:true,url:'http://127.0.0.1:8788',token:'test-only'},
    fetcher:async()=>Response.json({schemaVersion:'insidejob-stage2/1',status:'proposed'})});
  assert.ok(allocated>38000&&allocated<=120000,'bounded deadline must cover observed two-pass inference latency');
  await callStage2('analyze',{}, {config:{configured:true,url:'http://127.0.0.1:8788',token:'test-only'},timeoutMs:5000,
    fetcher:async()=>Response.json({schemaVersion:'insidejob-stage2/1',status:'proposed'})});
  assert.equal(allocated,5000,'explicit caller budget is preserved');
});

test('AI planner sees ranked product details even when navigation fills its 35-link input budget',async()=>{
  const root='https://1up-usa.com/';let offered;
  await runResearch({url:root,maxPages:2,prioritizeLinks:async({links})=>{offered=links;return []},extractPage:async url=>({
    sourceUrl:url,status:'completed',strategy:'S01',content:{title:'Rack catalog',text:'Published rack information',
      links:url===root?[
        ...Array.from({length:36},(_,i)=>({url:root+'product-category/menu-'+i,label:'Rack category'})),
        {url:root+'product/quik-rack',label:'Quik Rack'}]:[]},warnings:[],evidence:[]})});
  assert.ok(offered.some(link=>link.url===root+'product/quik-rack'));
});

const sampleExtraction=sections=>({requestedUrl:'https://1up-usa.com/',sourceUrl:'https://1up-usa.com/',content:{
  title:'1UP USA',text:sections.map(s=>s.text).join('\n'),sourceSections:sections,
  sampledPages:sections.map(s=>({url:s.sourceUrl,title:s.title,textChars:s.text.length,truncated:false}))}});

test('JS source budget keeps About evidence when product pages would crowd it out',()=>{
  const manufacturing='Our bike racks are proudly designed, manufactured, and assembled in the United States.';
  const sections=[{sourceUrl:'https://1up-usa.com/',title:'1UP USA',text:'We sell bicycle racks and accessories for vehicles.'},
    {sourceUrl:'https://1up-usa.com/about-us/',title:'About Us',text:'Background information. '.repeat(125)+manufacturing+' Further company information. '.repeat(35)},
    ...['quik-rack','heavy-duty','super-duty','equipd'].map(name=>({sourceUrl:'https://1up-usa.com/product/'+name,title:name,text:name+' is a tray-style bicycle rack for vehicle hitch receivers.'}))];
  const sources=selectJsSources(sampleExtraction(sections));
  assert.equal(sources.length,4);
  assert.equal(sources[0].url,'https://1up-usa.com/');
  const about=sources.find(s=>s.url.endsWith('/about-us/'));
  assert.ok(about,'identity evidence must not be discarded by product-page ranking');
  assert.ok(about.promptText.includes(manufacturing),'bounded About excerpt must retain its manufacturing statement');
  assert.equal(sources.filter(s=>s.url.includes('/product/')).length,2);
});

test('JS6 cannot add in-house capability to a genuine quote about product design goals',async()=>{
  const quote='All 1UP USA products are designed and built with one goal in mind—to make transporting your bike and gear easy.';
  const result=await buildJsProfile({run:async()=>({response:{facts:[{
    js:'JS6',claim:'1UP USA performs design and construction of bike racks in-house',quote,sourceId:1
  }]}})},sampleExtraction([{sourceUrl:'https://1up-usa.com/',title:'1UP USA',text:quote}]));
  assert.equal(result.sections.find(s=>s.code==='JS6').claims.length,0);
  assert.equal(result.coverage.rejectedSuggestions,1);
  const explicit='We design and manufacture bicycle racks in-house at our Wisconsin facility.';
  const good=await buildJsProfile({run:async()=>({response:{facts:[{js:'JS6',claim:'Manufactures bicycle racks in-house',quote:explicit,sourceId:1}]}})},
    sampleExtraction([{sourceUrl:'https://1up-usa.com/',title:'1UP USA',text:explicit}]));
  assert.equal(good.sections.find(s=>s.code==='JS6').claims.length,1);
});

test('JS6 internal-work guard distinguishes negated outsourcing from suppliers or negated manufacturing',async()=>{
  for(const [quote,count] of [
    ['We do not outsource manufacturing because we fabricate all racks in-house.',1],
    ['Our suppliers manufacture all racks in-house at their own facilities.',0],
    ['We do not manufacture bicycle racks in-house.',0]
  ]){
    const result=await buildJsProfile({run:async()=>({response:{facts:[{js:'JS6',claim:'Manufactures racks in-house',quote,sourceId:1}]}})},
      sampleExtraction([{sourceUrl:'https://1up-usa.com/',title:'1UP USA',text:quote}]));
    assert.equal(result.sections.find(s=>s.code==='JS6').claims.length,count,quote);
  }
});

test('Stage 2 reports partial when the JS profile failed even if product inference succeeded',async()=>{
  const response=await handleStage2Request(new Request('http://localhost/api/stage2/analyze',{method:'POST',
    headers:{authorization:'Bearer test-only','Content-Type':'application/json'},
    body:JSON.stringify({rootUrl:'https://1up-usa.com/',pages:[{url:'https://1up-usa.com/',title:'1UP USA',text:'Quik Rack is a bicycle rack for vehicle hitch receivers.'}]})}),
    {SCRAPPERS_API_TOKEN:'test-only',AI:{run:async(_model,args)=>{
      if(args.response_format.json_schema.properties.facts)throw Error('Model request failed');
      return {response:{products:[]}};
    }}});
  const data=await response.json();
  assert.equal(data.jsProfile.status,'unavailable');
  assert.equal(data.status,'partial');
});

test('JS2 category terms must appear in the supporting quote rather than a nearby application slogan',async()=>{
  const slogan='THE ULTIMATE HAULER — READY FOR ROAD BIKES, E-BIKES, AND EVERYTHING IN BETWEEN.';
  const description='Quik Rack is an easy-to-use tray-style bike rack designed for vehicle hitch receivers.';
  const result=await buildJsProfile({run:async()=>({response:{facts:[
    {js:'JS2',claim:'offers bike racks as a product category',quote:slogan,sourceId:1},
    {js:'JS2',claim:'offers bike racks as a product category',quote:description,sourceId:1}
  ]}})},sampleExtraction([{sourceUrl:'https://1up-usa.com/',title:'1UP USA',text:slogan+' '+description}]));
  const claims=result.sections.find(s=>s.code==='JS2').claims;
  assert.equal(claims.length,1);
  assert.equal(claims[0].quote,description);
});

test('manufacturer evidence preserves its complete source sentence instead of clipped word fragments',()=>{
  for(const sentence of [
    'From raw aluminum to road-ready, our bike racks are proudly designed, manufactured, and assembled in the United States.',
    'Our bike racks are manufactured in the U.S.A. by our team.'
  ]){
    const text='Most orders ship quickly unless otherwise noted.\n\nHow It Is Made\n\n'+sentence+'\n\nEvery rack has replaceable parts and a focus on reliability.';
    const role=identifyCompanyRole([{url:'https://1up-usa.com/about-us/',status:'completed',title:'About Us',aiText:text}],'https://1up-usa.com/');
    assert.equal(role.evidence[0]?.quote,sentence);
    assert.ok(text.includes(role.evidence[0].quote));
  }
});
