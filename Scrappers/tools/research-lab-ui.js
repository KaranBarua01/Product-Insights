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
  function setBusy(b){submit.disabled=b;cancel.disabled=!b;$('taxonomy-file').disabled=b;$('stage2-publish').disabled=b;}
  async function refresh(){
    const data=await api('/api/status');
    events.textContent=(data.events||[]).slice(-45).map(e=>`${e.time.slice(11,19)} | ${e.status.padEnd(10)} | ${e.url||''} ${e.chars!==undefined?'('+e.chars+' chars)':''}`).join('\n');
    if(!data.busy&&timer){clearInterval(timer);timer=null;}
    showInstalledTaxonomy(data);
    $('stage2-status').textContent=(data.stage2AiConfigured?'Cloudflare Workers AI endpoint configured. ':'Cloudflare AI not connected; local candidates and review still work. ')+('Working taxonomy edition: '+(data.localEditionVersion||0)+'.');
  }
  function showInstalledTaxonomy(data){
    const manifest=data.taxonomyManifest,loaded=Number(data.taxonomyNodes||0)>0;
    const status=$('taxonomy-status'),details=$('taxonomy-details');details.replaceChildren();
    if(!loaded){status.textContent='No local taxonomy installed. Install it once using the section below.';return;}
    status.textContent=`Ready · ${manifest?.totalNodes||data.taxonomyNodes} verified-format nodes loaded from this PC.`;
    append(details,'div',`Reference: ${manifest?.sourceName||'Local file'} · ${data.taxonomySource||'local source'}`);
    if(manifest?.levelCounts)append(details,'div',Object.entries(manifest.levelCounts).map(([key,value])=>`${key}: ${value}`).join(' · '));
    if(manifest?.nodeHash)append(details,'div',`Installed version (SHA-256): ${manifest.nodeHash.slice(0,16)}…`);
    append(details,'div','File structure validated; classification accuracy not certified.','small');
  }
  function render(report){
    const root=$('results');root.replaceChildren();$('result-card').hidden=false;exportLink.hidden=false;
    const summ=$('summary');summ.replaceChildren();
    for(const [name,value] of Object.entries({ 'Pages visited':report.coverage.visitedPages,'Links discovered':report.coverage.discoveredLeads,'Product/model/category leads':report.coverage.productLeads??report.coverage.structuredProducts,'Taxonomy candidates':report.coverage.taxonomyCandidates,'Unmapped products':report.coverage.taxonomyGaps}))append(summ,'span',`${value} ${name.toLowerCase()}`);
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
    append(root,'h3','Evidence-backed product and product-family leads');
    if(!report.products.length)append(root,'p','No product or product-family candidates found in this bounded sample. This is not proof the company has no products.','warn');
    else for(const p of report.products){
      const detail=append(root,'details'),sum=append(detail,'summary',p.name+(p.sku?' · '+p.sku:''));
      append(detail,'div',(p.evidenceType||'Unspecified evidence')+' · '+(p.kind||'product_model')+' · requires human verification','small');
      if(p.quote)append(detail,'p','Published page excerpt: '+p.quote,'small');
      const row=append(detail,'p');row.append(urlLink(p.sourceUrl,'Open product source'));
      if(p.material)append(detail,'p','Published material: '+p.material);
      const mapping=p.taxonomy;
      if(mapping.status==='not_loaded')append(detail,'p','Load taxonomy before running research to see possible codes.','small');
      else if(mapping.suggestions.length){append(detail,'p','Candidate codes — NOT validated:');
        for(const m of mapping.suggestions){append(detail,'div',`${m.path} | ${m.code} | lexical score ${m.score}`,'small');}
      }else append(detail,'p','Taxonomy gap or insufficient evidence — do not force a code.','warn');
    }
    if(report.stage2){
      append(root,'h3','Stage 2 research intelligence');
      append(root,'p','Cloudflare AI analysis: '+report.stage2.aiStatus+' · Product suggestions: '+report.stage2.aiProductCandidates+
        ' · Local page leads: '+report.stage2.offlineCandidates+' · Taxonomy proposals: '+report.stage2.proposals.length,'small');
      const profile=report.stage2.companyProfile;
      if(profile?.sections){
        for(const section of profile.sections){
          const detail=append(root,'details');
          append(detail,'summary',section.code+' · '+section.title+' ('+(section.claims?.length||0)+' proposed claims)');
          append(detail,'p',section.note||'','small');
          for(const claim of section.claims||[]){
            append(detail,'p',claim.claim);
            append(detail,'p','Verbatim quote: '+claim.quote,'small');
            const ref=append(detail,'p');ref.append(urlLink(claim.sourceUrl,'Open source evidence'));
          }
        }
      }else append(root,'p','JS1–JS10 profile unavailable until the updated Cloudflare Worker is configured and deployed.','small');
      for(const e of report.stage2.errors||[])append(root,'p','AI diagnostic: '+e,'warn');
    }
    append(root,'h3','Method and limitations');
    for(const text of report.limitations||[])append(root,'p',text,'small');
    for(const warn of report.warnings||[])append(root,'p',warn,'warn');
  }
  async function loadProposals(){
    const data=await api('/api/stage2/proposals'),root=$('stage2-proposals');root.replaceChildren();
    const list=data.proposals||[],pending=list.filter(p=>p.status==='pending'),approved=list.filter(p=>p.status==='approved');
    append(root,'p',list.length+' total proposal(s), '+pending.length+' pending review, '+approved.length+' approved and not published.','small');
    if(!list.length){append(root,'p','No proposals yet. Research a public manufacturer with taxonomy installed; the connected Cloudflare agent will propose changes for defensible gaps.','small');return;}
    for(const p of list.slice(-40).reverse()){
      const detail=append(root,'details');
      append(detail,'summary',p.status.toUpperCase()+' · '+p.kind+' · '+p.label);
      append(detail,'p','AI rationale: '+p.reason,'small');
      append(detail,'p','Parent: '+(p.parentCode||'—')+' · Existing code: '+(p.existingCode||'—'),'small');
      append(detail,'p','Website finding: '+p.productName+' · '+p.quote,'small');
      const line=append(detail,'p');line.append(urlLink(p.sourceUrl,'Open original source'));
      if(p.status==='pending'){
        for(const [decision,label] of [['approved','Approve proposal'],['rejected','Reject proposal']]){
          const button=append(detail,'button',label,decision==='approved'?'primary':'');
          button.type='button';
          button.addEventListener('click',async()=>{
            if(!confirm('Review this unverified website/AI proposal and mark it '+decision+'? It will NOT modify the master taxonomy.'))return;
            button.disabled=true;
            try{await api('/api/stage2/review',{method:'POST',body:JSON.stringify({id:p.id,decision})});await loadProposals();}
            catch(e){$('stage2-status').textContent='Review failed: '+e.message;button.disabled=false;}
          });
        }
      }else if(p.approval?.decidedAt)append(detail,'p','Reviewed: '+p.approval.decidedAt,'small');
    }
  }
  $('stage2-refresh').addEventListener('click',()=>loadProposals().catch(e=>{$('stage2-status').textContent=e.message;}));
  $('stage2-publish').addEventListener('click',async()=>{
    if(!confirm('Publish approved taxonomy changes to a versioned LOCAL working edition? The original master taxonomy and Cloudflare remain unchanged.'))return;
    const button=$('stage2-publish');button.disabled=true;
    try{
      const result=await api('/api/stage2/publish',{method:'POST',body:'{}'});
      $('stage2-status').textContent='Local working edition '+result.version+' published: '+result.addedNodes+' new nodes and '+result.aliasesAdded+' new aliases. Not canonical.';
      await loadProposals();
    }catch(e){$('stage2-status').textContent='Publication failed: '+e.message;}
    finally{button.disabled=false;}
  });
  $('taxonomy-file').addEventListener('change',async ev=>{
    const file=ev.target.files?.[0];if(!file)return;
    if(file.size>7_000_000){$('taxonomy-status').textContent='File exceeds 7 MB limit.';return;}
    $('taxonomy-status').textContent='Reading taxonomy locally...';
    try{
      const body=await file.text();
      const response=await fetch('/api/taxonomy',{method:'POST',headers:{'x-lab-token':token,'Content-Type':'text/plain; charset=utf-8','x-taxonomy-name':file.name.replace(/[^a-zA-Z0-9. ()_\-]/g,'').slice(0,100)},body,cache:'no-store'});
      const r=await response.json();if(!response.ok)throw Error(r.error||'Installation failed');
      showInstalledTaxonomy({taxonomyNodes:r.nodeCount,taxonomySource:r.source,taxonomyManifest:r.manifest});
      $('taxonomy-install-panel').open=false;
    }
    catch(e){$('taxonomy-status').textContent='Taxonomy rejected: '+e.message;}
  });
  $('run-form').addEventListener('submit',async ev=>{
    ev.preventDefault();setBusy(true);$('result-card').hidden=true;exportLink.hidden=true;events.textContent='';status.textContent='Starting research. Website access is subject to robots.txt, DNS safety and server restrictions.';
    timer=setInterval(()=>refresh().catch(()=>{}),700);
    try{
      const body={url:$('site').value.trim(),maxPages:Number($('pages').value),strategy:$('strategy').value,browser:$('browser').value};
      const response=await api('/api/run',{method:'POST',body:JSON.stringify(body)});
      render(response.report);loadProposals().catch(()=>{});status.textContent=`Finished ${response.report.coverage.visitedPages} pages. Download JSON for review.`;
    }catch(e){status.textContent='Research failed: '+e.message;}
    finally{setBusy(false);if(timer){clearInterval(timer);timer=null;}refresh().catch(()=>{});}
  });
  cancel.addEventListener('click',async()=>{try{await api('/api/cancel',{method:'POST',body:'{}'});status.textContent='Stop requested; finishing current page.';}catch(e){status.textContent=e.message;}});
  refresh().catch(e=>{status.textContent='Unable to load local lab status: '+e.message;});
  loadProposals().catch(e=>{$('stage2-status').textContent='Could not load review queue: '+e.message;});
})();