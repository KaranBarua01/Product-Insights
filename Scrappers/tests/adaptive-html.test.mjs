import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHtml} from '../dist/html.js';
test('HTML parser prioritizes in-main product card anchors over global 180-link navigation',()=>{
 const nav=Array.from({length:180},(_,i)=>'<a href="/nav/menu-'+i+'">About '+i+'</a>').join('');
 const products=Array.from({length:230},(_,i)=>'<a href="/products/model-'+i+'">Pump model '+i+'</a>').join('');
 const html='<html><head><title>Industrial Product Catalog</title></head><body>'+
   '<nav>'+nav+'</nav><main><h1>Industrial Product Catalog</h1>'+products+
   '<p>Model 240: built with stainless steel housing.</p></main></body></html>';
 const result=parseHtml(html,'https://example.com/catalog');
 assert.ok(result.content.links.length>=230);
 assert.equal(result.content.links[0].url,'https://example.com/products/model-0');
 assert.ok(result.content.links.some(x=>x.url.endsWith('/products/model-229')));
 assert.ok(result.content.text.includes('stainless steel housing'));
});
test('HTML parser retains the end of a long technical product description while bounding text',()=>{
 const technical='Specifications: Material: aluminum. Includes mounting brackets. Weight: 8 kg.';
 const html='<html><body><main><h1>Pump X-240</h1><p>'+
   'Primary description. '.repeat(2800)+'</p><p>'+technical+'</p></main></body></html>';
 const result=parseHtml(html,'https://example.com/products/x-240');
 assert.ok(result.content.text.length>35_000);
 assert.ok(result.content.text.length<=90_000);
 assert.ok(result.content.text.includes(technical));
});
