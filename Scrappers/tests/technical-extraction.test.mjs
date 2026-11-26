import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {parseHtml} from '../dist/html.js';
import {extract} from '../dist/engine.js';
import {samplePdfPages,extractPdfLayout,unpdfParser} from '../dist/s03.js';
import {runResearchV3,selectEvidenceWindows} from '../tools/research-v3.mjs';
import {createLocalPdfOcr} from '../tools/local-pdf-ocr.mjs';

const root='https://maker.example.com/',host='maker.example.com',url=root+'catalog.pdf';
const policy={allowedHosts:[host],maxHtmlPages:1};
const text='Pump model 100. Pressure rating 25 bar. Stainless steel impeller.';
const pdf=new TextEncoder().encode('%PDF-1.4\nmock fixture');
const response=(body,contentType='application/pdf',status=200,headers={})=>new Response(body,{status,headers:{'content-type':contentType,...headers}});
const fetcher=async target=>target.endsWith('/robots.txt')?response('','text/plain',404):response(pdf);
const extractPdf=(pages,opts={})=>extract({url,mode:'S03',maxPdfPages:15},{
 fetcher,pdfParser:async()=>({pageCount:pages.length,totalPages:opts.totalPages??pages.length,pages}),...opts.dependencies
}, {...policy,...opts.policy});

test('HTML rows preserve empty cells, spans, units, header type and source locator',()=>{
 const body='<main><table><tr><th colspan="3">Technical data</th></tr><tr><th>Part</th><th>Size</th><th>Tolerance</th></tr>'+
 '<tr><td rowspan="2">Shaft</td><td></td><td>&plusmn;0.01 mm</td></tr><tr><td>10 &micro;m</td><td>25&deg;C / 2 &Omega;</td></tr></table></main>';
 const t=parseHtml(body,root+'product/pump').content.tables[0];
 assert.deepEqual(t.rows,[['Technical data'],['Part','Size','Tolerance'],['Shaft','','±0.01 mm'],['10 µm','25°C / 2 Ω']]);
 assert.equal(t.rowMeta[0].cells[0].colspan,3);
 assert.equal(t.rowMeta[0].cells[0].header,true);
 assert.equal(t.rowMeta[2].cells[0].rowspan,2);
 assert.equal(t.hasMergedCells,true);assert.equal(t.sourceUrl,root+'product/pump');assert.equal(t.tableIndex,1);
});
test('HTTP scraper retains actual HTML technical tables instead of discarding them',async()=>{
 const target=root+'product/pump';
 const html='<main><h1>Pump</h1><table><tr><th>Component</th><th>Material</th></tr><tr><td>Shaft</td><td>Steel</td></tr></table></main>';
 const r=await extract({url:target,mode:'S01'},{fetcher:async u=>u.endsWith('/robots.txt')?response('','text/plain',404):response(html,'text/html')},policy);
 assert.equal(r.content.tables[0].sourceUrl,target);
 assert.deepEqual(r.content.tables[0].rows[1],['Shaft','Steel']);
});
test('table truncation is explicit and no empty cell is shifted away',()=>{
 const rows=Array.from({length:71},()=>'<tr><td>Part</td><td></td><td>'+('A'.repeat(221))+'</td></tr>').join('');
 const r=parseHtml('<main><table>'+rows+'</table></main>',root);
 assert.equal(r.content.tables[0].rows.length,70);assert.equal(r.content.tables[0].rows[0][1],'');
 assert.equal(r.content.tables[0].truncated,true);assert.ok(r.warnings.some(w=>w.includes('extraction limits')));
});
test('PDF sampling is deterministic, covers late pages and never exceeds 15',()=>{
 assert.deepEqual(samplePdfPages(3,8),[1,2,3]);assert.deepEqual(samplePdfPages(100,1),[1]);
 const selected=samplePdfPages(100,15);
 assert.equal(selected.length,15);assert.equal(selected[0],1);assert.equal(selected.at(-1),100);
 assert.equal(new Set(selected).size,15);assert.ok(selected.every((p,i)=>i===0||p>selected[i-1]));
});
test('PDF native layout preserves lines and retains aligned visual rows as review candidates',()=>{
 const item=(str,x,y,width=40,hasEOL=false)=>({str,transform:[12,0,0,12,x,y],width,height:12,hasEOL});
 const out=extractPdfLayout([
 item('Component',20,600,70),item('Material',180,600,60,true),
 item('Shaft',20,580),item('Steel',180,580,40,true),
 item('Pressure 25 bar',20,540,110,true)
 ]);
 assert.match(out.text,/Component\nMaterial\nShaft\nSteel/);
 assert.match(out.text,/Pressure 25 bar/);
 assert.equal(out.layoutRows.length,2);
 assert.deepEqual(out.layoutRows[1].cells.map(c=>c.text),['Shaft','Steel']);
 assert.equal(out.layoutRows[0].reviewStatus,'geometry_candidate_requires_review');
 assert.equal(out.textTruncated,false);
});
test('isolated visual two-column line is not promoted to a table row',()=>{
 const item=(str,x,y)=>({str,transform:[12,0,0,12,x,y],width:30});
 assert.deepEqual(extractPdfLayout([item('Left',10,100),item('Right',180,100)]).layoutRows,[]);
});
test('large PDF transfer is explicitly gated and remains bounded',async()=>{
 const bytes=new Uint8Array(3_100_000);bytes.set(pdf);
 const fetcher=async u=>u.endsWith('/robots.txt')?response('','text/plain',404):response(bytes);
 let calls=0;
 const deps={fetcher,pdfParser:async()=>{calls++;return {pageCount:1,totalPages:1,pages:[{page:1,text}]}}};
 const denied=await extract({url,mode:'S03'},deps,{...policy,maxBytesPdf:12_000_000});
 assert.equal(denied.status,'failed');assert.match(denied.reason,/3000000-byte/);assert.equal(calls,0);
 const ok=await extract({url,mode:'S03'},deps,{...policy,maxBytesPdf:12_000_000,allowLargePdf:true});
 assert.equal(ok.status,'completed');assert.equal(ok.content.pdfCoverage.byteLength,bytes.length);assert.equal(calls,1);
 const tooLarge=await extract({url,mode:'S03'},{...deps,fetcher:async u=>u.endsWith('/robots.txt')?response('','text/plain',404):response(pdf,'application/pdf',200,{'content-length':'12000001'})},{...policy,maxBytesPdf:20_000_000,allowLargePdf:true});
 assert.equal(tooLarge.status,'failed');assert.match(tooLarge.reason,/12000000-byte/);assert.equal(calls,1);
});
test('partial byte range is not accepted as a complete PDF',async()=>{
 let calls=0;
 const r=await extract({url,mode:'S03'},{fetcher:async u=>u.endsWith('/robots.txt')?response('','text/plain',404):response(pdf,'application/pdf',206),pdfParser:async()=>{calls++;return {pageCount:1,pages:[{page:1,text}]}}},policy);
 assert.equal(r.status,'failed');assert.match(r.reason,/Incomplete PDF/);assert.equal(calls,0);
});
test('mixed scanned and native PDF pages produce partial coverage and separate OCR requirements',async()=>{
 const r=await extractPdf([{page:1,text},{page:2,text:''},{page:20,text:text+' Late specification 50 kN.'}],{totalPages:20});
 assert.equal(r.status,'partial');assert.deepEqual(r.content.pdfCoverage.selectedPages,[1,2,20]);
 assert.deepEqual(r.content.pdfCoverage.ocrRequiredPages,[2]);assert.equal(r.content.pdfCoverage.unassessedPages,17);
 assert.equal(r.content.pdfPages[1].ocrStatus,'required');assert.deepEqual(r.evidence.map(e=>e.locator),['PDF page 1','PDF page 20']);
});
test('an entirely scanned bounded sample stays needs_ocr, even when unassessed pages remain',async()=>{
 const r=await extractPdf([{page:1,text:''}],{totalPages:10});
 assert.equal(r.status,'needs_ocr');assert.equal(r.content.pdfCoverage.unassessedPages,9);assert.deepEqual(r.evidence,[]);
});
test('OCR is limited to three pages and never enters native text or digital evidence',async()=>{
 const calls=[];
 const r=await extractPdf(Array.from({length:5},(_,i)=>({page:i+1,text:''})),{dependencies:{pdfOcr:async(bytes,selected)=>{
   calls.push(selected);return selected.map(page=>({page,text:'Recognized material stainless steel. Review this source.'}));
 }}});
 assert.deepEqual(calls,[[1,2,3]]);assert.equal(r.status,'needs_ocr');assert.equal(r.evidence.length,0);
 assert.ok(!r.content.text.includes('Recognized'));assert.equal(r.content.pdfPages[0].ocrStatus,'review_ready');
 assert.equal(r.content.pdfPages[3].ocrStatus,'not_attempted_budget');
});
test('OCR adapter failure is honest and does not create claims',async()=>{
 const r=await extractPdf([{page:1,text:''}],{dependencies:{pdfOcr:async()=>{throw Error('not installed')}}});
 assert.equal(r.content.pdfPages[0].ocrStatus,'failed');assert.equal(r.content.pdfPages[0].ocrText,undefined);assert.equal(r.evidence.length,0);
});
test('late technical evidence and unit-bearing lines are selected verbatim with page locators',()=>{
 const intro='Company history and general information.\n'.repeat(300);
 const p={pdfPages:[{page:1,text:intro},{page:55,text:'Shaft diameter: 25 mm ±0.01 mm. Material: stainless steel.'}]};
 const windows=selectEvidenceWindows(p);
 assert.ok(windows.some(w=>w.locator==='PDF page 55'&&w.text.includes('±0.01 mm')));
 assert.ok(windows.every(w=>p.pdfPages.find(x=>'PDF page '+x.page===w.locator).text.slice(w.start,w.end)===w.text));
 assert.ok(windows.map(w=>w.text).join('\n[... omitted source text ...]\n').length<=4800);
});
test('planner exposes OCR review separately without accepting OCR-only pages as intelligence evidence',async()=>{
 const r=await extractPdf([{page:1,text:''}],{dependencies:{pdfOcr:async()=>[{page:1,text:'Review recognized pump model and pressure specification 25 bar.'}]}});
 const accepted=[];
 const report=await runResearchV3({url,maxPages:1,delayMs:0,extractPage:async()=>r,onEvidence:(x)=>accepted.push(x)});
 assert.equal(report.pages[0].status,'needs_ocr');assert.equal(report.pages[0].aiText,'');assert.equal(accepted.length,0);
 assert.equal(report.pages[0].technicalReview.ocrReview[0].page,1);
 assert.equal(report.coverage.pdfPagesNeedingOcr,1);assert.equal(report.coverage.pdfOcrReviewPages,1);
});
test('mixed OCR candidates are omitted from downstream raw evidence, while review retains them',async()=>{
 const r=await extractPdf([{page:1,text},{page:2,text:''}],{dependencies:{pdfOcr:async()=>[{page:2,text:'Review recognized component and pressure rating 25 bar.'}]}});
 const accepted=[];
 const report=await runResearchV3({url,maxPages:1,delayMs:0,extractPage:async()=>r,onEvidence:x=>accepted.push(x)});
 assert.equal(accepted.length,1);assert.equal(accepted[0].content.pdfPages[1].ocrText,undefined);
 assert.ok(!report.pages[0].aiText.includes('recognized'));assert.equal(report.pages[0].technicalReview.ocrReview.length,1);
});
test('local OCR adapter validates page counts, fixes executable names and never uses a shell',async()=>{
 const calls=[];
 const ocr=createLocalPdfOcr({run:async(exe,args,opts)=>{
   calls.push({exe,args,opts});
   if(exe==='pdftoppm'){await writeFile(args.at(-1)+'.png',Buffer.from('fixture'));return {stdout:''};}
   return {stdout:'Pump model 100 pressure 25 bar.'};
 }});
 await assert.rejects(ocr(pdf,[1,2,3,4]),/at most three/);
 const out=await ocr(pdf,[2]);assert.equal(out[0].page,2);assert.deepEqual(calls.map(c=>c.exe),['pdftoppm','tesseract']);
 assert.ok(calls.every(c=>c.opts.shell===false&&c.opts.timeout<=15000&&c.opts.maxBuffer===256000));
 assert.deepEqual(calls[0].args.slice(0,4),['-f','2','-l','2']);
});
// Tiny genuine vector PDF fixture: no private source, external network or generated deliverable.
function makePdf(pages=1){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const kids=[];
 for(let n=1;n<=pages;n++){
   const p=objects.length+1,s=p+1;kids.push(p+' 0 R');
   objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents '+s+' 0 R >>');
   const stream='BT /F1 20 Tf 40 720 Td (PUMP MODEL 100 PRESSURE 25 BAR) Tj ET\nBT /F1 14 Tf 40 670 Td (Component) Tj 180 0 Td (Material) Tj ET\nBT /F1 14 Tf 40 645 Td (Shaft) Tj 180 0 Td (Steel) Tj ET\nBT /F1 14 Tf 40 600 Td (PAGE '+n+' SPECIFICATION) Tj ET\n';
   objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream');
 }
 objects[1]='<< /Type /Pages /Count '+pages+' /Kids ['+kids.join(' ')+'] >>';
 let doc='%PDF-1.4\n';const offsets=[0];
 for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(doc));doc+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';}
 const xref=Buffer.byteLength(doc);
 doc+='xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
 doc+='trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
 return new Uint8Array(Buffer.from(doc));
}
test('real PDF parser extracts late page, native lines and aligned layout candidates',async()=>{
 const r=await unpdfParser(makePdf(20),4);
 assert.equal(r.totalPages,20);assert.deepEqual(r.pages.map(p=>p.page),[1,2,11,20]);
 assert.match(r.pages.at(-1).text,/PAGE 20 SPECIFICATION/);
 assert.ok(r.pages[0].layoutRows.some(row=>row.cells.some(c=>c.text==='Shaft')&&row.cells.some(c=>c.text==='Steel')));
});
test('real local OCR renders and recognizes a synthetic PDF page',{skip:process.env.PI_TEST_LOCAL_OCR!=='1'},async()=>{
 const ocr=createLocalPdfOcr();
 const result=await ocr(makePdf(),[1]);
 assert.equal(result.length,1);assert.match(result[0].text,/PUMP MODEL 100 PRESSURE 25 BAR/i);
});
