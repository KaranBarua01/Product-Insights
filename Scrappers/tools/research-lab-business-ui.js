/* Two-mode local Lab: Manuel's evidence-backed business view and the
 * unchanged engineer console. Never HTML-inject untrusted website or OS text.
 */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const token=document.querySelector('meta[name="lab-token"]').content;
  let current=null,poll=null;
  function node(tag,value,cls){
    const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);
    if(cls)n.className=cls;return n;
  }
  function append(parent,tag,value,cls){
    const n=node(tag,value,cls);parent.append(n);return n;
  }
  function link(raw,label){
    const a=node('a',label||raw||'Open source');
    try{const u=new URL(raw);
      if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();
      a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';
    }catch{a.removeAttribute('href');}
    return a;
  }
  async function api(path,{method='GET',body=null}={}){
    const response=await fetch(path,{method,
      headers:method==='POST'?{'x-lab-token':token,'Content-Type':'application/json'}:{},
      body:body===null?undefined:JSON.stringify(body),cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Local Lab request failed');
    return data;
  }
  function setMode(mode){
    const business=mode==='business';
    $('business-view').hidden=!business;$('technical-view').hidden=business;
    $('mode-business').classList.toggle('is-active',business);
    $('mode-technical').classList.toggle('is-active',!business);
    $('mode-business').setAttribute('aria-pressed',String(business));
    $('mode-technical').setAttribute('aria-pressed',String(!business));
  }
  $('mode-business').addEventListener('click',()=>setMode('business'));
  $('mode-technical').addEventListener('click',()=>setMode('technical'));
  $('biz-open-technical').addEventListener('click',()=>setMode('technical'));
  function setBusy(b){
    $('biz-start').disabled=!!b;
    $('os-snapshot-file').disabled=!!b;
    $('os-clear').disabled=!!b;
  }
  function metric(root,value,title){
    const card=append(root,'div',undefined,'biz-metric');
    append(card,'strong',value);append(card,'span',title);
  }
  function list(root,values,fallback){
    if(!values?.length){append(root,'p',fallback,'biz-subtle');return;}
    const ul=append(root,'ul');
    for(const value of values.slice(0,7))append(ul,'li',value);
  }
  function evidence(root,item){
    if(item?.evidence?.quote)append(root,'span','Source: "'+item.evidence.quote+'"','biz-quote');
    const source=item?.evidence?.sourceUrl||item?.sourceUrl;
    if(source)append(root,'div').append(link(source,'Open original page'));
  }
  function productPanel(p,index){
    const detail=node('details',undefined,'biz-product');
    if(index===0)detail.open=true;
    const summary=append(detail,'summary');
    const label=append(summary,'strong',p.name+(p.sku?' · '+p.sku:''));
    label.title='Provisional website record, requires review';
    append(summary,'span',(p.specifications||[]).length+' specs · '+
      (p.components||[]).length+' components · '+(p.materials||[]).length+' materials');
    const body=append(detail,'div',undefined,'biz-product-body');
    append(body,'p','Product evidence: '+(p.sourceMethod||'website source')+
      ' · sold/manufactured relationship not determined.','biz-subtle');
    body.append(link(p.sourceUrl,'Open product source'));
    const fields=append(body,'div',undefined,'biz-columns');
    const left=append(fields,'div');
    const cats=append(left,'div',undefined,'biz-field');
    append(cats,'h5','Category / product hierarchy');
    if(p.categories?.length)list(cats,p.categories,'Not linked');
    else append(cats,'p','Category relationship not established from this website sample.','biz-subtle');
    const s=append(left,'div',undefined,'biz-field');
    append(s,'h5','Specifications (published claims)');
    if(!p.specifications?.length)append(s,'p','Not found in sampled product evidence.','biz-subtle');
    for(const entry of (p.specifications||[]).slice(0,10)){
      append(s,'strong',entry.name+': '+entry.value);
      evidence(s,entry);
    }
    const right=append(fields,'div');
    const comp=append(right,'div',undefined,'biz-field');
    append(comp,'h5','Components mentioned (NOT confirmed BOM parts)');
    if(!p.components?.length)append(comp,'p','No explicit inclusion mentions found.','biz-subtle');
    for(const entry of (p.components||[]).slice(0,10)){
      append(comp,'strong',entry.name);evidence(comp,entry);
    }
    const mat=append(right,'div',undefined,'biz-field');
    append(mat,'h5','Materials explicitly stated');
    if(!p.materials?.length)append(mat,'p','No explicit product material statements found.','biz-subtle');
    for(const entry of (p.materials||[]).slice(0,10)){
      append(mat,'strong',entry.name);evidence(mat,entry);
    }
    append(body,'div','Parts/BOM: Not established. Manufacturing processes required for this product: Not established.','biz-warning');
    const identity=p.identityEvidence?.find(e=>e.quote);
    if(identity)append(body,'p','Identity evidence: "'+identity.quote+'"','biz-subtle');
    return detail;
  }
  function renderCompare(b){
    const root=$('biz-os-comparison');root.replaceChildren();
    const cmp=b.osComparison||{},os=append(root,'article');
    append(os,'span','EXISTING INSIDEJOB OS','biz-eyebrow');
    if(cmp.status==='os_not_connected'){
      append(os,'h4','Not connected');
      append(os,'p','No OS data has been imported. Do not interpret this as zero existing records.','biz-subtle');
      append(os,'p','Use an actual OS company JSON export to make this comparison.','biz-subtle');
    }else{
      append(os,'h4',cmp.osCompany?.name||'Imported OS company');
      if(cmp.status==='company_mismatch')
        append(os,'p','Company website mismatch. Comparison is withheld.','biz-warning');
      const counts=cmp.osCounts||{};
      append(os,'div',counts.products??'unknown','big-number');
      append(os,'p','Products in imported snapshot (not a live OS API)','biz-subtle');
      list(os,[
        (counts.categories??0)+' category entries',
        (counts.parts??0)+' standalone part entries',
        (counts.productLinkedParts??0)+' product-linked part entries',
        (counts.manufacturingProcesses??0)+' standalone process entries',
        (counts.productLinkedProcesses??0)+' product-linked process entries'
      ],'No OS records available.');
    }
    const research=append(root,'article');
    append(research,'span','PRODUCT INSIGHTS / WEBSITE','biz-eyebrow');
    append(research,'h4','Current research candidates');
    append(research,'div',b.coverage.products,'big-number');
    append(research,'p','Product records discovered in sampled pages','biz-subtle');
    list(research,[
      b.coverage.categories+' candidate categories',
      b.coverage.componentMentions+' component mentions (not validated parts)',
      b.coverage.materialClaims+' material claims',
      b.coverage.specifications+' technical specifications',
      '0 product manufacturing processes established'
    ],'No website results.');
    if(cmp.status==='comparable_imported_snapshot'){
      const status=append(root,'div',undefined,'biz-warning');
      append(status,'strong',(cmp.productMatches||[]).length+' possible existing names · '+
        (cmp.researchOnlyCandidates||[]).length+' research-only candidate names');
      append(status,'p','Name differences are not confirmed missing records, and manufacturing ownership is not established.');
      if(cmp.researchOnlyCandidates?.length)
        append(status,'p','Sample candidates: '+cmp.researchOnlyCandidates.slice(0,5).join(' · '));
    }
  }
  function renderTaxonomy(b){
    const root=$('biz-taxonomy');root.replaceChildren();
    const entries=(b.taxonomy||[]).filter(x=>x.suggestions?.length).slice(0,12);
    if(!entries.length){
      append(root,'div','No source-backed taxonomy matches can be presented as approved. Install the taxonomy to see candidate mappings; its absence is not a missing category.','biz-warning');
      return;
    }
    append(root,'p','These are lexical / proposed matches. No classification has been approved by OS.','biz-subtle');
    const rows=append(root,'div',undefined,'biz-mapping-list');
    for(const entry of entries){
      const row=append(rows,'div',undefined,'biz-mapping');
      append(row,'span',entry.family);append(row,'span','→','arrow');
      const candidate=append(row,'div');
      append(candidate,'strong',entry.suggestions[0].label);
      append(candidate,'div','Candidate · '+entry.suggestions[0].code,'biz-code');
    }
  }
  function renderProcesses(b){
    const root=$('biz-processes');root.replaceChildren();
    const process=b.processEvidence||{},claims=process.claims||[];
    if(!claims.length){
      append(root,'div','Manufacturing process evidence has not been established. Do not infer machining, fabrication, injection molding or assembly from product names, parts or materials.','biz-warning');
      append(root,'p','When supported, JS5 will show product-relevant processes and JS6 will separately show company-performed capabilities.','biz-subtle');
      return;
    }
    append(root,'p','Unverified source quotations only. Claims below are NOT linked to any product or factory.','biz-warning');
    for(const c of claims.slice(0,10)){
      const details=append(root,'details');
      append(details,'summary',(c.section==='JS5'?'JS5 · Product-relevant process':'JS6 · Claimed company capability')+' · '+c.claim.slice(0,95));
      append(details,'p',c.claim);
      evidence(details,{evidence:c.evidence});
    }
  }
  function renderBusiness(b){
    if(!b||b.schemaVersion!=='pi-lab-business-view/v1')return;
    current=b;$('biz-results').hidden=false;$('biz-empty').hidden=true;
    $('biz-company').textContent=b.company.name;
    $('biz-role').textContent='Website: '+b.company.website+
      ' · Business role candidate: '+b.company.roleCandidate+' (unverified)';
    $('biz-run-status').textContent=b.acquisition.status==='sampled'?'Sampled website':'Limited / blocked research';
    const stats=$('biz-summary');stats.replaceChildren();
    metric(stats,b.coverage.pagesVisited,'Pages investigated');
    metric(stats,b.coverage.categories,'Candidate categories');
    metric(stats,b.coverage.products,'Product records');
    metric(stats,b.coverage.specifications,'Specifications');
    metric(stats,b.coverage.componentMentions+b.coverage.materialClaims,'Component / material mentions');
    $('biz-product-count').textContent=b.products.length+' source candidates';
    const hierarchy=$('biz-product-tree');hierarchy.replaceChildren();
    if(!b.products.length)append(hierarchy,'div','No defensible product entities found in sampled pages. This is NOT proof the company has no products.','biz-warning');
    else{
      for(const [i,p] of b.products.slice(0,45).entries())hierarchy.append(productPanel(p,i));
      if(b.products.length>45)append(hierarchy,'p','Showing first 45 records. Download the complete candidate JSON.','biz-subtle');
    }
    renderCompare(b);renderTaxonomy(b);renderProcesses(b);
    const tiny={...b.handoff,products:(b.handoff?.products||[]).slice(0,2),
      _preview:'Showing at most two products; use Download JSON for the complete draft.'};
    $('biz-json-preview').textContent=JSON.stringify(tiny,null,2).slice(0,8500);
    $('biz-status').textContent='Research finished. Results require source review; no OS data was written.';
  }
  function refreshOs(data){
    const c=data?.osSnapshot?.company;
    $('os-status').textContent=c?
      'Imported local OS snapshot: '+c.name+' ('+c.website+'). Not a live OS connection.':
      'OS not connected — no baseline loaded.';
    if(data?.business)renderBusiness(data.business);
  }
  function stopPoll(){
    if(poll){clearInterval(poll);poll=null;}
  }
  async function progress(){
    const data=await api('/api/status');
    const done=(data.events||[]).filter(x=>['completed','partial'].includes(x.status)).length;
    $('biz-status').textContent='Researching public website · '+done+
      ' page event(s) completed. Results will appear only after extraction finishes.';
  }
  window.addEventListener('pi:research-start',()=>{
    setBusy(true);$('biz-results').hidden=true;$('biz-empty').hidden=false;
    $('biz-status').textContent='Investigating website. Respecting robots, access and per-page safety limits.';
    stopPoll();poll=setInterval(()=>progress().catch(()=>{}),1100);
  });
  window.addEventListener('pi:research-complete',event=>{
    stopPoll();setBusy(false);renderBusiness(event.detail?.business);
  });
  window.addEventListener('pi:research-error',event=>{
    stopPoll();setBusy(false);
    $('biz-status').textContent='Research stopped: '+(event.detail?.error||'unknown extraction error');
  });
  $('biz-form').addEventListener('submit',event=>{
    event.preventDefault();
    if($('biz-start').disabled)return;
    $('site').value=$('biz-site').value.trim();
    $('pages').value=$('biz-pages').value;
    $('run-form').requestSubmit();
  });
  $('os-snapshot-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>170000)throw Error('Use an OS JSON snapshot smaller than 170 KB.');
      const raw=JSON.parse(await file.text());
      const data=await api('/api/os/snapshot',{method:'POST',body:raw});
      refreshOs(data);
    }catch(e){$('os-status').textContent='OS snapshot import failed: '+e.message;}
    finally{event.target.value='';}
  });
  $('os-clear').addEventListener('click',async()=>{
    try{refreshOs(await api('/api/os/clear',{method:'POST',body:{}}));}
    catch(e){$('os-status').textContent='Could not clear OS snapshot: '+e.message;}
  });
  api('/api/business').then(refreshOs).catch(e=>{
    $('os-status').textContent='Local comparison not available: '+e.message;
  });
  setMode('business');
})();
