/* Local-only research controls; never execute website-provided HTML or scripts in this UI. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id),token=document.querySelector('meta[name="lab-token"]').content;
  const status=$('status'),events=$('events'),submit=$('start'),cancel=$('cancel'),exportLink=$('export');
  let timer=null;
  function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;return node;}
  function append(parent,tag,text,cls){const node=el(tag,text,cls);parent.append(node);return node;}
  function urlLink(url,label){const link=el('a',label||url);try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error();link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';}catch{link.removeAttribute('href');}return link;}
  async function api(path,{method='GET',body=null,type='application/json'}={}){
    const response=await fetch(path,{method,headers:{...(method==='POST'?{'x-lab-token':token,'Content-Type':type}: {})},body:body===null?undefined:body,cache:'no-store'});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;
  }
  function setBusy(b){submit.disabled=b;cancel.disabled=!b;$('taxonomy-file').disabled=b;}
  async function refresh(){
    const data=await api('/api/status');
    events.textContent=(data.events||[]).slice(-45).map(e=>`${e.time.slice(11,19)} | ${e.status.padEnd(10)} | ${e.url||''} ${e.chars!==undefined?'('+e.chars+' chars)':''}`).join('\n');
    if(!data.busy&&timer){clearInterval(timer);timer=null;}
    if(data.taxonomyNodes) $('taxonomy-status').textContent=`${data.taxonomyNodes} taxonomy nodes loaded (${data.taxonomySource}).`;
  }
  function render(report){
    const root=$('results');root.replaceChildren();$('result-card').hidden=false;exportLink.hidden=false;
    const summ=$('summary');summ.replaceChildren();
    for(const [name,value] of Object.entries({ 'Pages visited':report.coverage.visitedPages,'Links discovered':report.coverage.discoveredLeads,'Products in JSON-LD':report.coverage.structuredProducts,'Taxonomy candidates':report.coverage.taxonomyCandidates,'Unmapped products':report.coverage.taxonomyGaps}))append(summ,'span',`${value} ${name.toLowerCase()}`);
    append(root,'p',`Research status: ${report.status}. Source text and taxonomy suggestions require human review.`,'small');
    append(root,'h3','Visited source pages');
    const sc=append(root,'div',undefined,'scroll'),table=append(sc,'table'),thead=append(table,'thead'),hdr=append(thead,'tr');
    for(const name of ['Website page','Strategy','Status','Text chars','Evidence'])append(hdr,'th',name);
    const tbody=append(table,'tbody');
    for(const page of report.pages){
      const row=append(tbody,'tr'),c=append(row,'td');c.append(urlLink(page.url,page.title||page.url));append(c,'div',page.url,'small');
      append(row,'td',page.strategy);append(row,'td',page.status);append(row,'td',page.textChars);
      const evidenceCell=append(row,'td');
      const detail=append(evidenceCell,'details'),title=append(detail,'summary',`${page.evidence.length} evidence records · view excerpt`);
      append(detail,'p',page.snippet||'No extractable page text','small');
      for(const finding of page.evidence.slice(0,6))append(detail,'p',`${finding.locator}: ${finding.excerpt}`,'small');
      for(const w of page.warnings.slice(0,3))append(detail,'p',w,'warn');
    }
    append(root,'h3','Structured product leads');
    if(!report.products.length)append(root,'p','No Product JSON-LD records found in this bounded sample. This does not mean the company has no products. A later AI research pass is needed for non-structured catalogs.','warn');
    else for(const p of report.products){
      const detail=append(root,'details'),sum=append(detail,'summary',p.name+(p.sku?' · '+p.sku:''));
      append(detail,'div','Website-published JSON-LD · Unverified product candidate','small');
      const row=append(detail,'p');row.append(urlLink(p.sourceUrl,'Open product source'));
      if(p.material)append(detail,'p','Published material: '+p.material);
      const mapping=p.taxonomy;
      if(mapping.status==='not_loaded')append(detail,'p','Load taxonomy before running research to see possible codes.','small');
      else if(mapping.suggestions.length){append(detail,'p','Candidate codes — NOT validated:');
        for(const m of mapping.suggestions){append(detail,'div',`${m.path} | ${m.code} | lexical score ${m.score}`,'small');}
      }else append(detail,'p','Taxonomy gap or insufficient evidence — do not force a code.','warn');
    }
    append(root,'h3','Method and limitations');
    for(const text of report.limitations||[])append(root,'p',text,'small');
    for(const warn of report.warnings||[])append(root,'p',warn,'warn');
  }
  $('taxonomy-file').addEventListener('change',async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    if(file.size>7_000_000){$('taxonomy-status').textContent='File exceeds 7 MB limit.';return;}
    $('taxonomy-status').textContent='Reading taxonomy locally...';
    try{const body=await file.text();const r=await api('/api/taxonomy',{method:'POST',body,type:'text/plain; charset=utf-8'});$('taxonomy-status').textContent=`Loaded ${r.nodeCount} valid taxonomy entries. Run research to generate suggestions.`;}
    catch(e){$('taxonomy-status').textContent='Taxonomy rejected: '+e.message;}
  });
  $('run-form').addEventListener('submit',async ev=>{
    ev.preventDefault();setBusy(true);$('result-card').hidden=true;exportLink.hidden=true;events.textContent='';status.textContent='Starting research. Website access is subject to robots.txt, DNS safety and server restrictions.';
    timer=setInterval(()=>refresh().catch(()=>{}),700);
    try{
      const body={url:$('site').value.trim(),maxPages:Number($('pages').value),strategy:$('strategy').value,browser:$('browser').value};
      const response=await api('/api/run',{method:'POST',body:JSON.stringify(body)});
      render(response.report);status.textContent=`Finished ${response.report.coverage.visitedPages} pages. Download JSON for review.`;
    }catch(e){status.textContent='Research failed: '+e.message;}
    finally{setBusy(false);if(timer){clearInterval(timer);timer=null;}refresh().catch(()=>{});}
  });
  cancel.addEventListener('click',async()=>{try{await api('/api/cancel',{method:'POST',body:'{}'});status.textContent='Stop requested; finishing current page.';}catch(e){status.textContent=e.message;}});
  refresh().catch(e=>{status.textContent='Unable to load local lab status: '+e.message;});
})();