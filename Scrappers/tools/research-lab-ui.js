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
  function renderProductIntelligence(root,report){
    const intel=report.productIntelligence;
    if(!intel)return;
    append(root,'h3','Product Intelligence Extractor V1 — source-backed candidate records');
    const c=intel.coverage||{};
    append(root,'p','Discovered '+(c.categories||0)+' candidate categories, '+(c.products||0)+
      ' product records, '+(c.specifications||0)+' labeled specifications, '+
      (c.components||0)+' component mentions and '+(c.materials||0)+
      ' material mentions. All require review; missing evidence remains unknown.','small');
    const role=intel.company?.roleCandidate?.primaryRole||'unknown';
    append(root,'p','Company role: '+role+' (unverified). A distributor selling products is not their manufacturer.','warn');
    const cats=intel.categories||[];
    const catNames=new Map(cats.map(x=>[x.id,x.name]));
    if(cats.length){
      const box=append(root,'details');
      append(box,'summary','Observed product-category pages ('+cats.length+')');
      for(const cat of cats.slice(0,35)){
        const row=append(box,'p');
        row.append(urlLink(cat.sourceUrl,cat.name));
        append(row,'span',' · '+cat.reviewStatus,'small');
      }
    }
    const products=intel.products||[];
    if(!products.length)append(root,'p','No identifiable products in this bounded source sample. Do not treat this as an empty catalog.','warn');
    for(const product of products.slice(0,45)){
      const box=append(root,'details');
      append(box,'summary',product.name+(product.sku?' · '+product.sku:'')+
        ' — specs '+(product.specifications||[]).length+
        ', components '+(product.components||[]).length+
        ', materials '+(product.materials||[]).length);
      const source=append(box,'p');
      source.append(urlLink(product.sourceUrl,'Open observed product page'));
      append(source,'span',' · '+product.extractionMethod+' · review required','small');
      if(product.categoryIds?.length)
        append(box,'p','Observed category link: '+product.categoryIds.map(id=>catNames.get(id)||'unknown').join(' · '),'small');
      else append(box,'p','Category relationship unresolved — not inferred.','small');
      for(const ev of (product.evidence||[]).slice(0,2))
        append(box,'p','Identity evidence ('+ev.method+'): '+ev.quote,'small');
      const groups=[['Specifications',product.specifications,x=>x.attribute+': '+x.value],
        ['Components',product.components,x=>x.component],
        ['Materials',product.materials,x=>x.material]];
      for(const [label,items,format] of groups){
        if(!items?.length)continue;
        append(box,'h4',label+' (source-published, unverified)');
        for(const item of items.slice(0,10)){
          const detail=append(box,'details');
          append(detail,'summary',format(item));
          append(detail,'p','Source quote: '+(item.evidence?.quote||'Not available'),'small');
          if(item.evidence?.sourceUrl)append(detail,'p').append(urlLink(item.evidence.sourceUrl,'Open evidence source'));
        }
      }
    }
    if(products.length>45)append(root,'p','Showing 45 of '+products.length+' candidate products. Export JSON for all records.','small');
  }
  function render(report){
    const root=$('results');root.replaceChildren();$('result-card').hidden=false;exportLink.hidden=false;
    const summ=$('summary');summ.replaceChildren();
    for(const [name,value] of Object.entries({
      'Pages sampled':report.coverage.visitedPages,
      'Product / SKU leads':report.coverage.productLeads??report.coverage.structuredProducts,
      'Candidate product families':report.coverage.productFamilies??0,
      'Unresolved FAMILY mappings':report.coverage.taxonomyGaps??0
    }))append(summ,'span',value+' '+name.toLowerCase());
    append(root,'p','PROVISIONAL research sample. Counts are not verified catalog coverage, manufacturing qualifications, or confirmed taxonomy gaps.','warn');
    const q=report.evidenceQuality;
    if(q){
      append(root,'h3','Acquisition evidence quality');
      append(root,'p',q.verdict.replace(/_/g,' ')+' · '+q.score+'/100 observed signal coverage (not verified accuracy)',q.falseSuccessRisk?'warn':'small');
      append(root,'p',q.counts.retrieved+' retrieved / '+q.counts.accepted+' accepted / '+q.counts.relevant+' relevant of '+q.counts.attempted+' attempted; '+q.distinctProductCandidates+' source-backed product candidates.');
      append(root,'p','Not observed in this sample: '+(q.missingDimensions.join(', ')||'none of the tracked signal types')+'. Missing is not absent.','small');
      append(root,'p','Stop: '+q.stopReason.replace(/_/g,' ')+' · '+q.remainingLeads+' queued leads · '+q.frontierDropped+' discarded by frontier limit. Catalog completeness and accuracy are unmeasured.','small');
      const details=append(root,'details');
      append(details,'summary','Observed evidence signals and gaps');
      for(const [name,d] of Object.entries(q.dimensions)){
        append(details,'h4',name+' · '+d.status.replace(/_/g,' ')+' ('+d.distinctExcerpts+')');
        for(const ex of d.examples){
          const p=append(details,'p',ex.locator+': '+ex.quote+' ','small');
          p.append(urlLink(ex.sourceUrl,'Source'));
        }
      }
      append(details,'p',q.unassessedSources.length+' inaccessible, failed or insufficient source attempts; '+q.partialSources.length+' partially assessed sources.','small');
    }
    append(root,'h3','Company role — website statements only');
    const role=report.companyRole;
    if(!role||role.status==='unknown')append(root,'p','Unknown: sampled pages contain no explicit self-description. Do not assume this website manufactures products.','warn');
    else{
      append(root,'p','Candidate: '+role.primaryRole.replace(/_/g,' ')+' · human review required.');
      for(const evidence of role.evidence||[]){
        const item=append(root,'details');
        append(item,'summary',evidence.role+' · quoted website statement');
        append(item,'p',evidence.quote,'small');
        append(item,'p').append(urlLink(evidence.sourceUrl,'Open source'));
      }
    }
    append(root,'h3','Candidate product families (grouped before taxonomy)');
    const groups=report.families||[];
    if(!groups.length)append(root,'p','No defensible product families in this bounded sample. This does not mean the company has no products.','warn');
    for(const p of groups){
      const detail=append(root,'details');
      append(detail,'summary',p.name+' · '+p.memberCount+' lead(s)');
      append(detail,'p','Provisional family, grouped by name or model. '+p.uniqueSkus+' unique explicit SKU(s), '+p.sourceUrls.length+' source page(s).','small');
      if(p.quote)append(detail,'p','Source excerpt: '+p.quote,'small');
      append(detail,'p').append(urlLink(p.sourceUrl,'Open family source'));
      const mapping=p.taxonomy||{status:'not_loaded',suggestions:[]};
      if(mapping.status==='not_loaded')append(detail,'p','Taxonomy not loaded. This is NOT a gap.','warn');
      else if(mapping.suggestions?.length){
        append(detail,'p','Unverified candidate taxonomy classifications:');
        for(const m of mapping.suggestions)append(detail,'div',m.path+' | '+m.code+' | lexical score '+m.score,'small');
      }else{
        append(detail,'p','Unresolved mapping or insufficient evidence — NOT a confirmed missing category.','warn');
        if(p.leadId){
          const manual=append(detail,'button','Propose a reusable taxonomy category');manual.type='button';
          manual.addEventListener('click',async()=>{
            manual.disabled=true;
            try{
              const data=await api('/api/stage2/parents');
              const box=append(detail,'div');
              append(box,'label','Reusable class label (NOT a SKU or model)');
              const label=append(box,'input');label.type='text';label.placeholder='e.g. Bicycle Hitch Racks';label.maxLength=150;
              append(box,'label','Existing taxonomy parent (select only after reviewing taxonomy)');
              const select=append(box,'select'),empty=append(select,'option','Select parent');empty.value='';
              for(const n of data.parents||[]){const opt=append(select,'option','L'+n.level+' · '+n.path);opt.value=n.code;}
              append(box,'label','Evidence-based explanation for missing category');
              const reason=append(box,'input');reason.type='text';reason.maxLength=500;reason.placeholder='Explain why existing categories cannot classify this family';
              const save=append(box,'button','Queue proposal for human review');save.type='button';save.className='primary';
              save.addEventListener('click',async()=>{
                save.disabled=true;
                try{
                  const out=await api('/api/stage2/manual-proposal',{method:'POST',body:JSON.stringify({
                    leadId:p.leadId,kind:'new_node',label:label.value,parentCode:select.value,reason:reason.value})});
                  $('stage2-status').textContent=out.added?'Family-level proposal queued.':'A matching proposal is already in the queue.';
                  await loadProposals();
                }catch(e){$('stage2-status').textContent='Proposal refused: '+e.message;save.disabled=false;}
              });
            }catch(e){$('stage2-status').textContent='Cannot load taxonomy parents: '+e.message;manual.disabled=false;}
          });
        }
      }
      const members=append(detail,'details');
      append(members,'summary','Expand '+p.memberCount+' underlying product/model records');
      for(const m of p.members||[]){
        const line=append(members,'p');
        line.append(urlLink(m.sourceUrl,m.name+(m.sku?' · '+m.sku:'')));
        if(m.evidenceType)append(line,'span',' · '+m.evidenceType,'small');
      }
    }
    renderProductIntelligence(root,report);
    append(root,'h3','Visited source pages');
    const sc=append(root,'div',undefined,'scroll'),table=append(sc,'table'),thead=append(table,'thead'),hdr=append(thead,'tr');
    for(const name of ['Website page','Strategy','Status','Text chars','Evidence'])append(hdr,'th',name);
    const tbody=append(table,'tbody');
    for(const page of report.pages){
      const row=append(tbody,'tr'),c=append(row,'td');c.append(urlLink(page.url,page.title||page.url));append(c,'div',page.url,'small');
      append(row,'td',page.strategy);append(row,'td',page.status);append(row,'td',page.textChars);
      const evidenceCell=append(row,'td'),detail=append(evidenceCell,'details');
      append(detail,'summary',page.evidence.length+' evidence records · view excerpt');
      append(detail,'p',page.snippet||'No extractable page text','small');
      for(const finding of page.evidence.slice(0,6))append(detail,'p',finding.locator+': '+finding.excerpt,'small');
      for(const w of page.warnings.slice(0,3))append(detail,'p',w,'warn');
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
    ev.preventDefault();setBusy(true);window.dispatchEvent(new CustomEvent('pi:research-start'));$('result-card').hidden=true;exportLink.hidden=true;events.textContent='';status.textContent='Starting research. Website access is subject to robots.txt, DNS safety and server restrictions.';
    timer=setInterval(()=>refresh().catch(()=>{}),700);
    try{
      const body={url:$('site').value.trim(),maxPages:Number($('pages').value),strategy:$('strategy').value,browser:$('browser').value};
      const response=await api('/api/run',{method:'POST',body:JSON.stringify(body)});
      render(response.report);window.dispatchEvent(new CustomEvent('pi:research-complete',{detail:{business:response.business}}));loadProposals().catch(()=>{});status.textContent=`Finished ${response.report.coverage.visitedPages} pages. Download JSON for review.`;
    }catch(e){status.textContent='Research failed: '+e.message;window.dispatchEvent(new CustomEvent('pi:research-error',{detail:{error:e.message}}));}
    finally{setBusy(false);if(timer){clearInterval(timer);timer=null;}refresh().catch(()=>{});}
  });
  cancel.addEventListener('click',async()=>{try{await api('/api/cancel',{method:'POST',body:'{}'});status.textContent='Stop requested; finishing current page.';}catch(e){status.textContent=e.message;}});
  refresh().catch(e=>{status.textContent='Unable to load local lab status: '+e.message;});
  loadProposals().catch(e=>{$('stage2-status').textContent='Could not load review queue: '+e.message;});
})();