import libraryJson from '../data/pattern-library.json' with {type:'json'};
import type {Assessment, Candidate, Evidence, PageSignals, PatternDefinition, Signal, WebsiteAnalysis, FrequencyEntry} from './types.js';
export const LIBRARY:PatternDefinition[]=libraryJson.patterns.map(p=>({...p,group:p.group as PatternDefinition['group']}));
// Code => observable signal, grouped by strength. An absent signal is NOT proof of a website-wide absence.
const RULES:Record<string,{observed?:string[];lead?:string[];mode?:'review'}>={
  I01:{observed:['company_narrative'],lead:['about_link']},
  I02:{observed:['product_link']}, I03:{observed:['product_detail','product_schema'],lead:['nested_product_link']},
  I04:{observed:['spec_table']}, I05:{observed:['capability_page'],lead:['capability_link']},
  I06:{observed:['document_link'],lead:['document_link']}, I07:{lead:['market_link']}, I08:{lead:['brand_link']},
  I09:{mode:'review'}, I10:{lead:['service_page']}, I11:{lead:['aftermarket']},
  I12:{observed:['capability_page'],lead:['capability_link']}, I13:{mode:'review'},
  N01:{observed:['navigation']}, N02:{observed:['breadcrumb'],lead:['nested_product_link']},
  N03:{observed:['filter_url'],lead:['facet_control']}, N04:{observed:['filter_url']},
  N05:{lead:['cross_host']}, N06:{mode:'review'}, N07:{observed:['locale_link'],lead:['locale_link']},
  N08:{lead:['pagination']}, N09:{mode:'review'}, N10:{observed:['accordion'],lead:['accordion_candidate']},
  N11:{lead:['load_more']}, N12:{observed:['search_form'],lead:['search_form']},
  R01:{observed:['readable_html']},R02:{observed:['jsonld'],lead:['jsonld_invalid']},
  R03:{observed:['app_state'],lead:['app_state_marker']},R04:{lead:['sparse_shell']},
  R05:{observed:['pdf_response']},R06:{observed:['challenge']},
  R07:{lead:['hydration']},R08:{mode:'review'},R09:{lead:['error_body']},
  T01:{lead:['wordpress']},T02:{lead:['webflow']},T03:{lead:['drupal']},
  T04:{lead:['nextjs']},T05:{lead:['react']},T06:{lead:['shopify']}
};
export function detectorCoverage(){
 const pat=LIBRARY.filter(x=>x.group!=='method');
 return {sitePatterns:pat.filter(x=>x.group!=='technology').length,technologySignals:pat.filter(x=>x.group==='technology').length,methods:LIBRARY.filter(x=>x.group==='method').length,automatic:pat.filter(x=>RULES[x.id]&&RULES[x.id]?.mode!=='review').length,review:pat.filter(x=>RULES[x.id]?.mode==='review').length};
}
function pickSignal(pages:PageSignals[],names:string[],minimum:'observed'|'lead'):{page:PageSignals;signal:Signal}|null{
  for(const page of pages){for(const s of page.signals){if(!names.includes(s.type))continue;
    if(minimum==='observed'&&s.certainty==='lead')continue;
    return {page,signal:s};
  }}return null;
}
export function classify(pages:PageSignals[],createdAt:string):{assessments:Assessment[];candidates:Candidate[]} {
 const assessments:Assessment[]=[];
 for(const p of LIBRARY){
   if(p.group==='method')continue;
   const rule=RULES[p.id];
   let status:Assessment['status']='not_assessed',note='No reliable automatic detector for this pattern; requires targeted review.';
   const evidence:Evidence[]=[];
   if(rule?.mode!=='review'&&rule){
     const found=pickSignal(pages,rule.observed??[],'observed');
     const lead=found??pickSignal(pages,rule.lead??[],'lead');
     if(lead){
       status=found?'observed':'lead';
       note=found?'Observed in a sampled response; does not establish whole-site coverage.':'Candidate signal only; behavior not verified.';
       const s=lead.signal;
       evidence.push({id:`${p.id}-${evidence.length+1}`,patternId:p.id,sourceUrl:lead.page.url,signal:s.type,locator:s.locator,excerpt:s.excerpt,method:s.type==='pdf_response'?'http-pdf':'http-html',observedAt:createdAt});
     }else if(pages.some(pg=>pg.contentType.includes('html'))){
       // Limited negative: sampled HTML pages only. Never infer absent across unvisited templates.
       status='not_observed';note='No matching signal in sampled HTML; absence on the entire website is NOT established.';
     }
   }
   assessments.push({patternId:p.id,status,evidence,note});
 }
 const candidates:Candidate[]=[];
 for(const pg of pages){
   const marker=pg.signals.find(x=>x.type==='external_embedded_catalog');
   if(marker&&!candidates.some(x=>x.description==='Embedded external catalog/selector'))candidates.push({id:'candidate-embedded-selector',description:'Embedded external catalog/selector',sourceUrl:pg.url,evidence:marker.excerpt,status:'review_required'});
 }
 return {assessments,candidates};
}
export function frequency(analyses:WebsiteAnalysis[]):FrequencyEntry[]{
  // Newest result per host prevents repeated submissions inflating denominators.
  const byHost=new Map<string,WebsiteAnalysis>();
  for(const a of [...analyses].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))byHost.set(a.host,a);
  const unique=[...byHost.values()];
  return LIBRARY.filter(p=>p.group!=='method').map(p=>{
    const statuses=unique.map(a=>a.assessments.find(x=>x.patternId===p.id)?.status??'not_assessed');
    const observed=statuses.filter(s=>s==='observed').length;
    const notObserved=statuses.filter(s=>s==='not_observed').length;
    const leads=statuses.filter(s=>s==='lead').length;
    const notAssessed=statuses.filter(s=>s==='not_assessed').length;
    const assessed=observed+notObserved;
    return {id:p.id,name:p.name,group:p.group,observed,notObserved,leads,notAssessed,assessed,prevalence:assessed?observed/assessed:null};
  }).sort((a,b)=>b.observed-a.observed || b.assessed-a.assessed || a.id.localeCompare(b.id));
}
export function normalizeResults(analyses:WebsiteAnalysis[]){
 const latest=new Map<string,WebsiteAnalysis>();for(const a of analyses)latest.set(a.host,a);
 const selected=[...latest.values()];
 return {schemaVersion:'1.0',websites:selected.length,frequency:frequency(selected),matrix:selected.map(a=>({companyName:a.companyName??'',host:a.host,status:a.status,patterns:a.assessments.filter(p=>p.status==='observed').map(p=>p.patternId),leads:a.assessments.filter(p=>p.status==='lead').map(p=>p.patternId),pages:a.pages.length})),candidates:selected.flatMap(a=>a.candidates)};
}
const csvValue=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;
export function exportMatrixCsv(analyses:WebsiteAnalysis[]):string{
 const rows=normalizeResults(analyses).matrix;
 const codes=LIBRARY.filter(p=>p.group!=='method').map(p=>p.id);
 const header=['host','company_name','run_status','sampled_pages',...codes];
 const out=[header.map(csvValue).join(',')];
 for(const row of rows){const a=analyses.find(x=>x.host===row.host);const statuses=new Map(a?.assessments.map(x=>[x.patternId,x.status]));out.push([row.host,row.companyName,row.status,row.pages,...codes.map(code=>statuses.get(code)??'not_assessed')].map(csvValue).join(','));}
 return out.join('\n')+'\n';
}
