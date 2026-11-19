import test from 'node:test';
import assert from 'node:assert/strict';
import {pageHint,technicalSnippets,sampleExtraction,coverageMetrics,compareDepth} from '../tools/depth-coverage.mjs';
import {runResearch} from '../tools/research-planner.mjs';

const ROOT='https://manufacturer.example.org/';
const H='manufacturer.example.org';
function mock(url,{text='Industrial products',status='completed',strategy='S01',links=[],pdfPages=[],jsonLd=[]}={}){
  return {sourceUrl:url,status,strategy,reason:'Synthetic fixture only',attempts:[{strategy,status}],
    content:{text,links,jsonLd,pdfPages,documents:links.filter(x=>x.url.endsWith('.pdf')).map(x=>x.url),
      headings:['Industrial Equipment']},
    evidence:[{sourceUrl:url,locator:'primary text',excerpt:text.slice(0,50),method:strategy}]};
}
test('page and technical evidence hints are deliberately provisional',()=>{
  assert.equal(pageHint(ROOT),'homepage');
  assert.equal(pageHint(ROOT+'products/pump-x'),'product_detail_lead');
  assert.equal(pageHint(ROOT+'collections/industrial'),'category_lead');
  assert.equal(pageHint(ROOT+'capabilities/cnc'),'capability');
  assert.equal(pageHint(ROOT+'catalog/pump-spec.pdf','S03'),'pdf');
  assert.deepEqual(technicalSnippets('Contact our team today\nVoltage: 24 V DC\nWeight: 12 kg\nNo technical terms here',4),
    ['Voltage: 24 V DC','Weight: 12 kg']);
  assert.deepEqual(technicalSnippets('Beautiful, durable, industry-leading service'),[]);
});
test('provenance-aware source metrics distinguish visible product leads from verified facts',()=>{
  const page=sampleExtraction(ROOT+'products/mixer-x',mock(ROOT+'products/mixer-x',{
    text:'Mixer X is a product.\nPower: 240 W\nWeight: 12 kg\nOther marketing text.',
    links:[
      {url:ROOT+'categories/mixers',label:'Mixers'},
      {url:ROOT+'products/mixer-y',label:'Mixer Y'},
      {url:ROOT+'assets/datasheet.pdf',label:'Mixer PDF'},
      {url:'https://not-our-site.example.net/download.pdf',label:'Outside document'}
    ],
    jsonLd:[{'@type':'Product',name:'Mixer X',sku:'MX-240'}]
  }),H);
  assert.equal(page.kind,'product_detail_lead');
  assert.equal(page.structuredProducts.length,1);
  assert.equal(page.categoryLinks.length,1);
  assert.equal(page.productLinks.length,1);
  assert.equal(page.pdfLinks.length,1);
  assert.equal(page.technicalSnippets.length,2);
  const metrics=coverageMetrics([page],3);
  assert.equal(metrics.jsonLdProductRecords,1);
  assert.equal(metrics.categoryLinkLeads,1);
  assert.equal(metrics.productLinkLeads,1);
  assert.equal(metrics.pdfLinksDiscovered,1);
  assert.equal(metrics.pdfDocumentsRead,0);
  assert.equal(metrics.technicalLineSignals,2);
  assert.equal(metrics.evidenceRecords,1);
  assert.equal(metrics.uniqueSuccessfulSourceUrls,1);
});
test('same-trace page-three prefix is nested in deeper result and obeys abstentions',()=>{
  const data=[];
  data.push(sampleExtraction(ROOT,mock(ROOT,{text:'Industrial manufacturer profile'}),H));
  data.push(sampleExtraction(ROOT+'about',mock(ROOT+'about',{text:'We distribute components.'}),H));
  data.push(sampleExtraction(ROOT+'products',mock(ROOT+'products',{text:'Product categories'}),H));
  data.push(sampleExtraction(ROOT+'products/model-x',mock(ROOT+'products/model-x',{
    text:'Model X\nPressure 20 bar\nCapacity 100 kg',jsonLd:[{'@type':'Product',name:'Model X'}]
  }),H));
  data.push(sampleExtraction(ROOT+'files/spec.pdf',mock(ROOT+'files/spec.pdf',{
    strategy:'S03',text:'Voltage 24 V\nWeight 2 kg',pdfPages:[{page:1,text:'Voltage 24 V'},{page:2,text:'Weight 2 kg'}]
  }),H));
  data.push(sampleExtraction(ROOT+'locked',mock(ROOT+'locked',{status:'blocked',text:''}),H));
  const {baseline3,depth12,gain}=compareDepth(data);
  assert.equal(baseline3.attemptedPages,3);
  assert.equal(depth12.attemptedPages,6);
  assert.equal(gain.usablePages,2);
  assert.equal(gain.jsonLdProductRecords,1);
  assert.equal(gain.pdfDocumentsRead,1);
  assert.equal(gain.pdfPagesRead,2);
  assert.equal(gain.technicalLineSignals,4);
  assert.equal(depth12.blockedPages,1);
  assert.equal(depth12.sourcePages.length,6);
  assert.throws(()=>coverageMetrics(data,13),/page budget/);
});
test('research planner can traverse twelve bounded same-host pages without network',async()=>{
  const links=Array.from({length:11},(_,i)=>({url:ROOT+'products/widget-'+(i+1),label:'Product Widget '+(i+1)}));
  const traces=[];
  const report=await runResearch({url:ROOT,maxPages:12,delayMs:0,
    extractPage:async url=>{
      const result=mock(url,{links:url===ROOT?links:[],
        text:url===ROOT?'Widget catalog':'Widget page\nWeight: 8 kg',
        jsonLd:url===ROOT?[]:[{'@type':'Product',name:'Widget '+new URL(url).pathname.split('/').pop()}]});
      traces.push(sampleExtraction(url,result,H));
      return result;
    }});
  assert.equal(report.pages.length,12);
  assert.equal(traces.length,12);
  const {baseline3,depth12,gain}=compareDepth(traces);
  assert.equal(baseline3.attemptedPages,3);
  assert.equal(depth12.attemptedPages,12);
  assert.equal(gain.usablePages,9);
  assert.equal(depth12.jsonLdProductRecords,11);
  assert.ok(depth12.technicalLineSignals>baseline3.technicalLineSignals);
});
