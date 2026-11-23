import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHtml} from '../dist/html.js';

test('HTML technical table row boundaries and material columns are preserved',()=>{
 const html='<html><head><title>Pump 100</title></head><body>'+
  '<nav><table><tr><td>Other Product</td><td>Steel</td></tr></table></nav>'+
  '<main><h1>Pump 100</h1><table><tr><th>Component</th><th>Material</th></tr>'+
  '<tr><td>Impeller</td><td>Stainless Steel</td></tr>'+
  '<tr><td>Seal</td><td>Rubber</td></tr></table></main></body></html>';
 const {content}=parseHtml(html,'https://maker.example.com/product/pump-100','S01');
 assert.equal(content.tables.length,1);
 assert.deepEqual(content.tables[0].rows,[['Component','Material'],['Impeller','Stainless Steel'],['Seal','Rubber']]);
 assert.ok(!content.tables[0].rows.some(x=>x.includes('Other Product')));
 assert.equal(content.headings[0],'Pump 100');
});

test('table parser caps oversized source rows and never invents missing attributes',()=>{
 const rows=Array.from({length:110},(_,i)=>'<tr><td>Part '+i+'</td><td>Material '+i+'</td></tr>').join('');
 const {content}=parseHtml('<main><table>'+rows+'</table></main>','https://maker.example.com/product/a','S01');
 assert.equal(content.tables[0].rows.length,70);
 assert.equal(content.tables[0].rows[0][0],'Part 0');
 assert.equal(content.tables[0].rows[69][0],'Part 69');
});
