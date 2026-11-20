import test from 'node:test';
import assert from 'node:assert/strict';
import {rankResearchLink,exploratoryCompanyLinks,runResearch} from '../tools/research-planner.mjs';

test('new industrial navigation labels rank as real research candidates',()=>{
 for(const path of ['/shop/linear-bearings','/equipment/scales','/components/valves',
   '/catalogue/dispensing-systems','/enclosures/wall-mount','/portfolio/robotics']){
   const result=rankResearchLink({url:'https://www.igus.com'+path,label:'Industrial product'},'www.igus.com');
   assert.ok(result?.score>=6,path);
 }
});
test('unknown website patterns fall back to bounded same-host exploration, not outside sites',()=>{
 const links=[
   {url:'https://www.newcompany.com/innovations',label:'Innovations'},
   {url:'https://www.newcompany.com/solutions',label:'Find solutions'},
   {url:'https://www.newcompany.com/news',label:'News'},
   {url:'https://www.newcompany.com/careers',label:'Career opportunities'},
   {url:'https://evil.example.com/products',label:'Buy'},
   {url:'http://127.0.0.1/admin',label:'Internal site'},
   {url:'https://www.newcompany.com/innovations',label:'Duplicate'}
 ];
 const r=exploratoryCompanyLinks(links,'www.newcompany.com',{max:3});
 assert.ok(r.some(x=>x.url.endsWith('/innovations')));
 assert.equal(r.some(x=>x.url.includes('evil.example.com')),false);
 assert.equal(r.some(x=>x.url.includes('127.0.0.1')),false);
 assert.equal(r.some(x=>x.url.endsWith('/news')),false);
 assert.equal(r.some(x=>x.url.endsWith('/careers')),false);
 assert.equal(new Set(r.map(x=>x.url)).size,r.length);
});
test('a nonstandard company navigation path gets visited instead of silently stopping after one page',async()=>{
 const urls=[];
 const result=await runResearch({url:'https://www.example-company.com/',maxPages:3,
   extractPage:async url=>{
     urls.push(url);
     return {status:'completed',strategy:'S01',sourceUrl:url,content:{
       title:'Example Company',
       text:'Company manufactures advanced fixtures.',
       headings:['Company','Fixtures'],
       links:url.endsWith('/')?[
         {url:'https://www.example-company.com/innovations',label:'Our Innovation'},
         {url:'https://www.example-company.com/contact',label:'Contact'},
       ]:[]},evidence:[],warnings:[]};
   }});
 assert.ok(urls.length>=2,JSON.stringify(urls));
 assert.equal(urls[1],'https://www.example-company.com/innovations');
 assert.ok(result.warnings.some(x=>x.includes('Exploratory')));
 assert.equal(result.coverage.visitedPages,2);
});
