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
      append(os,'p','OS provides no connected export/API to this Lab. This does not imply OS contains zero products.','biz-missing');
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
      if(cmp.status==='comparable_imported_snapshot'&&cmp.osProductSamples?.length){
        const details=append(os,'details');
        append(details,'summary','Open OS product → part → process records');
        for(const p of cmp.osProductSamples.slice(0,10)){
          const item=append(details,'div',undefined,'biz-field');
          append(item,'strong',p.name+' (imported OS record)');
          append(item,'p','Product category: '+(p.category||'Not supplied in OS snapshot'),'biz-subtle');
          append(item,'p','Parts in OS: '+(p.parts?.length?p.parts.join(', '):'Not supplied'),'biz-subtle');
          append(item,'p','Processes in OS: '+(p.manufacturingProcesses?.length?
            p.manufacturingProcesses.join(', '):'Not supplied'),'biz-subtle');
        }
      }
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
      append(root,'div',"We couldn't bring out approved taxonomy mappings. The taxonomy may be uninstalled or the site terminology may not match. Product categories are a separate finding.",'biz-missing');
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
      append(root,'div',"We couldn't bring this out. No product-to-process or in-house manufacturing relationship was established by website evidence.",'biz-missing');
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
  /** Visual states reflect evidence availability, not truth of source claims. */
  function badge(id,tone,label){
    const el=$(id);el.className='biz-chip '+tone;el.textContent=label;
  }
  function sectionRows(b){
    const n=b.coverage||{},other=b.otherSectionClaims||[],process=b.processEvidence?.claims||[];
    const pageRows=b.acquisition?.pageStatus||[];
    const sites=pageRows.filter(x=>x.url&&['completed','partial'].includes(x.status));
    const have=(code)=>other.some(x=>x.code===code&&x.evidence?.sourceUrl&&x.evidence?.quote);
    return [
      {code:'JS1',name:'Company overview & identity',tone:n.pagesVisited>0?'review':'unavailable',
       text:n.pagesVisited>0?'Website identity retrieved; OEM/distributor role is a candidate and needs review.':'No usable company overview could be established.'},
      {code:'JS2',name:'Product categories',tone:n.categories?'available':'unavailable',
       text:n.categories+' category candidates extracted from website sources.'},
      {code:'JS3',name:'Product & component hierarchy',tone:n.products?'available':'unavailable',
       text:n.products+' product candidates; '+n.componentMentions+' component mentions. Complete BOM is not established.'},
      {code:'JS4',name:'Materials',tone:n.materialClaims?'available':'unavailable',
       text:n.materialClaims+' explicitly published material claims; product-to-material coverage remains incomplete.'},
      {code:'JS5',name:'Product manufacturing process requirements',tone:process.some(x=>x.section==='JS5')?'review':'unavailable',
       text:'Product process claims need review; no verified product-to-process map exists.'},
      {code:'JS6',name:'Actual in-house manufacturing capability',tone:process.some(x=>x.section==='JS6')?'review':'unavailable',
       text:'In-house processes cannot be inferred from parts or product names. Only website claims can be shown.'},
      {code:'JS7',name:'Supply chain intelligence',tone:have('JS7')?'review':'unavailable',
       text:have('JS7')?'Source-quoted supply chain candidates; supplier/purchase details need review.':'Specific supplier and purchase relationships were not established.'},
      {code:'JS8',name:'Industries & target markets',tone:have('JS8')?'review':'unavailable',
       text:have('JS8')?'Website-quoted market/application candidates require review.':'Target markets could not be supported in the available findings.'},
      {code:'JS9',name:'Differentiators',tone:have('JS9')?'review':'unavailable',
       text:have('JS9')?'Source-quoted differentiators require review.':'Competitive differentiators could not be supported in the available findings.'},
      {code:'JS10',name:'Evidence & confidence',tone:sites.length?'available':'unavailable',
       text:sites.length+' usable source page(s); traceability is not independent fact verification.'}
    ];
  }
  function renderStatuses(b){
    const rows=sectionRows(b),totals={
      available:rows.filter(r=>r.tone==='available').length,
      review:rows.filter(r=>r.tone==='review').length,
      unavailable:rows.filter(r=>r.tone==='unavailable').length
    };
    const root=$('biz-coverage-summary');root.replaceChildren();
    function tile(value,label,tone,description){
      const card=append(root,'div',undefined,'biz-coverage-tile '+tone);
      append(card,'span',label);append(card,'strong',value);append(card,'small',description);
    }
    tile(totals.available,'Extracted information','available','Source found · not independently verified');
    tile(totals.review,'Needs human review','review','Website claim / AI interpretation');
    tile(totals.unavailable,"Couldn't bring out",'unavailable','No defensible finding this run');
    tile((b.acquisition?.pageStatus||[]).filter(x=>x.url&&['completed','partial'].includes(x.status)).length,
      'Usable page sources','blue','Actual website evidence');
    const sections=$('biz-js-coverage');sections.replaceChildren();
    for(const row of rows){
      const card=append(sections,'div',undefined,'biz-js-row '+row.tone);
      append(card,'b',row.code);
      const info=append(card,'div');
      append(info,'strong',row.name);
      append(info,'span',row.tone==='available'?'Extracted':row.tone==='review'?'Needs human review':"Couldn't bring this out",
        'biz-status '+row.tone);
      append(info,'p',row.tone==='unavailable'?"We couldn't bring this out. "+row.text:row.text,'biz-subtle');
    }
  }
  function renderCategories(b){
    const root=$('biz-categories');root.replaceChildren();
    badge('biz-categories-status',b.categories?.length?'available':'unavailable',
      b.categories?.length?'Extracted · requires verification':"Couldn't bring this out");
    if(!b.categories?.length){
      append(root,'div',"We couldn't bring this out. No product categories were extracted from the pages visited.",'biz-missing');return;
    }
    for(const category of b.categories.slice(0,40)){
      const card=append(root,'div',undefined,'biz-catcard');
      append(card,'strong',category.name);
      const linked=b.products.filter(p=>(p.categories||[]).includes(category.name));
      append(card,'p',linked.length?linked.length+' related product candidate(s)':'Category extracted; product relationships not established');
      if(category.sourceUrl)card.append(link(category.sourceUrl,'Open category source'));
    }
  }
  function renderSources(b){
    const root=$('biz-sources');root.replaceChildren();
    const pages=b.acquisition?.pageStatus||[];
    const successful=pages.filter(x=>x.url&&['completed','partial'].includes(x.status));
    badge('biz-sources-status',successful.length?'available':'unavailable',
      successful.length?successful.length+' usable pages':"Couldn't bring this out");
    if(!pages.length){append(root,'div',"We couldn't bring this out. The website did not provide page records.",'biz-missing');return;}
    for(const p of pages){
      const box=append(root,'div',undefined,'biz-sourceitem');
      if(p.url)box.append(link(p.url,'Source: '+p.url));
      append(box,'div','Result: '+(p.status||'unknown')+' · Strategy: '+(p.strategy||'unknown'),
        ['completed','partial'].includes(p.status)?'biz-available':'biz-missing');
    }
  }

  function renderBusiness(b){
    if(!b||b.schemaVersion!=='pi-lab-business-view/v1')return;
    current=b;$('biz-results').hidden=false;$('biz-empty').hidden=true;
    $('biz-company').textContent=b.company.name;
    $('biz-role').textContent='Website: '+b.company.website+
      ' · Business role candidate: '+b.company.roleCandidate+' (unverified)';
    badge('biz-run-status',b.coverage.pagesVisited?'review':'unavailable',
      b.coverage.pagesVisited?'Source sample · needs review':"Couldn't bring this out");
    $('biz-company-summary').textContent=b.coverage.pagesVisited?
      'This live investigation attempted '+b.coverage.pagesVisited+' pages, identified '+b.coverage.products+
      ' product candidates, '+b.coverage.categories+' categories, '+b.coverage.specifications+
      ' technical specifications and '+(b.coverage.componentMentions+b.coverage.materialClaims)+
      ' component/material mentions. Results cover only the sampled pages.':
      "We couldn't bring out usable product intelligence from the investigated website pages.";
    renderStatuses(b);renderCategories(b);renderSources(b);
    const stats=$('biz-summary');stats.replaceChildren();
    metric(stats,b.coverage.pagesVisited,'Pages investigated');
    metric(stats,b.coverage.categories,'Candidate categories');
    metric(stats,b.coverage.products,'Product records');
    metric(stats,b.coverage.specifications,'Specifications');
    metric(stats,b.coverage.componentMentions+b.coverage.materialClaims,'Component / material mentions');
    $('biz-product-count').textContent=b.products.length+' source candidates';
    const hierarchy=$('biz-product-tree');hierarchy.replaceChildren();
    if(!b.products.length)append(hierarchy,'div',"We couldn't bring this out. No defensible product entities were found on sampled pages. This does not prove the company has no products.",'biz-missing');
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
