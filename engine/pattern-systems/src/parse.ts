import type { LinkRecord, PageSignals, Signal } from './types.js';

const entityMap: Record<string,string> = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…'};
const decode = (text:string) => text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(_m,e:string)=>{
  if(e.startsWith('#')) { const n = e[1]?.toLowerCase()==='x' ? parseInt(e.slice(2),16):parseInt(e.slice(1),10); return n>0 && n<=0x10ffff ? String.fromCodePoint(n) : ' '; }
  return entityMap[e.toLowerCase()] ?? `&${e};`;
});
const plain = (html:string) => decode(html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
const trim = (s:string, max=170) => s.replace(/\s+/g,' ').trim().slice(0,max);
function attr(raw:string,name:string):string {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const m=raw.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i'));
  return decode(m?.[1]??m?.[2]??m?.[3]??'');
}
function findTags(html:string,tag:string):{attrs:string;inner:string}[]{
  const out:{attrs:string;inner:string}[]=[];
  const re=new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`,'gi');
  for(const m of html.matchAll(re)) out.push({attrs:m[1]??'',inner:m[2]??''});
  return out;
}
function add(signals:Signal[],type:string,excerpt:string,locator:string,certainty:'observed'|'lead'='observed'){
  if(signals.filter(s=>s.type===type).length>=6)return;
  signals.push({type,excerpt:trim(excerpt),locator:trim(locator,200),certainty});
}
function safeLink(raw:string,base:string):string|null{
  try {const u=new URL(raw,base);if(!['http:','https:'].includes(u.protocol))return null;u.hash='';return u.href;}
  catch{return null;}
}
export function analyzeHtml(html:string,url:string,status=200,contentType='text/html'):PageSignals{
  const signals:Signal[]=[];const links:LinkRecord[]=[];
  const host=new URL(url).hostname;
  const title=trim(plain(findTags(html,'title')[0]?.inner??''),130);
  const scriptless=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<!--[^]*?-->/g,' ');
  const body=/<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(scriptless)?.[1]??scriptless;
  const bodyText=plain(body).slice(0,200000);
  const textLength=bodyText.length;
  const path=new URL(url).pathname;
  if(textLength>=160)add(signals,'readable_html',`Initial response contains ${textLength} text characters`,'body');
  if(/\babout\b|our.company|who.we.are|our.story/i.test(path)&&textLength>220)add(signals,'company_narrative',bodyText.slice(0,160),'body');
  if(/\b(specification|technical data|dimensions|performance data|technical details)\b/i.test(bodyText)&&/<table\b/i.test(body))add(signals,'spec_table','Specifications and table in initial HTML','table');
  if(/\b(cnc machining|injection molding|investment casting|precision casting|fabrication|our manufacturing|our capabilities)\b/i.test(bodyText)&&/capabilit|manufactur|process|machin|foundry/i.test(path))add(signals,'capability_page',bodyText.match(/.{0,35}(?:cnc machining|injection molding|investment casting|fabrication|our capabilities).{0,50}/i)?.[0]??bodyText.slice(0,120),'body');
  if(/\b(discontinued|remanufactured|replacement parts|aftermarket)\b/i.test(bodyText))add(signals,'aftermarket','Aftermarket or lifecycle terminology found in content','body', 'lead');
  if(/\b(software solutions|managed services|our services|engineering services)\b/i.test(bodyText)&&/service|solution/i.test(path))add(signals,'service_page',bodyText.slice(0,140),'body','lead');
  if(/\b(sku|part number|model number)\b/i.test(bodyText)&&/\/product|\/part|\/item/i.test(path))add(signals,'product_detail','Product URL and visible model/part identifier terminology','body');
  if(/\b(error 404|page not found|temporarily unavailable|access denied)\b/i.test(title+' '+bodyText.slice(0,350)))add(signals,'error_body',title||bodyText.slice(0,80),'title/body','lead');
  if(/just a moment|checking your browser|attention required.*cloudflare/i.test(title+' '+bodyText.slice(0,400)))add(signals,'challenge',title||bodyText.slice(0,100),'title/body');
  if(textLength<120 && /<script\b/i.test(html))add(signals,'sparse_shell',`Only ${textLength} text characters in initial HTML`,'body','lead');
  if(/__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__NEXT/i.test(html))add(signals,'app_state_marker','App-state variable found in initial response','script','lead');
  if(/__NEXT_DATA__|__next|_next\/static/i.test(html))add(signals,'nextjs','Next.js initial HTML signal','script/src','lead');
  if(/wp-content\/|wp-includes\//i.test(html))add(signals,'wordpress','WordPress assets observed','src/href','lead');
  if(/data-wf-page|webflow\.js|webflow\.com/i.test(html))add(signals,'webflow','Webflow markup/assets observed','html/script','lead');
  if(/Drupal\.settings|drupalSettings|sites\/default\/files/i.test(html))add(signals,'drupal','Drupal markup/assets observed','script/src','lead');
  if(/data-reactroot|react-dom|__reactFiber/i.test(html))add(signals,'react','React hydration indicator','html/script','lead');
  if(/Shopify\.theme|cdn\.shopify\.com|shopify-section/i.test(html))add(signals,'shopify','Shopify storefront markup','script/src','lead');
  if(/__NEXT_DATA__|__NUXT__|data-server-rendered|ng-version|id=["']__next/i.test(html))add(signals,'hydration','Hydration/framework marker observed','html/script','lead');
  for(const script of findTags(html,'script')){
    const typ=attr(script.attrs,'type');const id=attr(script.attrs,'id');
    if(typ.toLowerCase()==='application/ld+json'){
      try{const value:unknown=JSON.parse(script.inner.trim());if(value&&typeof value==='object'){
        add(signals,'jsonld','Valid JSON-LD found in original response','script[type="application/ld+json"]');
        if(JSON.stringify(value).match(/"@type"\s*:\s*"Product"/i))add(signals,'product_schema','Schema.org Product node','script[type="application/ld+json"]');
      }}catch{add(signals,'jsonld_invalid','JSON-LD script present but unparseable','script[type="application/ld+json"]','lead');}
    }
    if(id==='__NEXT_DATA__'){
      try{JSON.parse(script.inner.trim());add(signals,'app_state','Parseable __NEXT_DATA__ JSON','script#__NEXT_DATA__');}catch{ /* state signal remains a lead */ }
    }
  }
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const attrs=m[1]??'';const raw=attr(attrs,'href');const href=safeLink(raw,url);if(!href)continue;
    const label=trim(plain(m[2]??''),110);const target=new URL(href);const external=target.hostname!==host;
    if(links.some(l=>l.href===href&&l.label===label))continue;
    links.push({href,label,external});
    const clue=(`${label} ${target.pathname}`).toLowerCase();
    if(/\/products?\b|\/catalog|\/category|\/series|\/famil|\/models?\b|product(s)?\b/i.test(clue))add(signals,'product_link',`${label} → ${target.pathname}`,`a[href="${href}"]`);
    if(/\/products?\/[^/?]+\/[^/?]+/i.test(target.pathname))add(signals,'nested_product_link',`${label} → ${target.pathname}`,`a[href="${href}"]`,'lead');
    if(/\/about|our.company|our.story|who.we.are/i.test(clue))add(signals,'about_link',label||href,`a[href="${href}"]`,'lead');
    if(/capabilit|manufactur|machin|process|molding|casting|fabricat|foundry/i.test(clue))add(signals,'capability_link',label||href,`a[href="${href}"]`,'lead');
    if(/industr|applications?|market/i.test(clue))add(signals,'market_link',label||href,`a[href="${href}"]`,'lead');
    if(/\bbrand|subsidiar|our companies|our business/i.test(clue))add(signals,'brand_link',label||href,`a[href="${href}"]`,'lead');
    if(/\.pdf(?:$|\?)/i.test(href)||/data(sheet)?|brochure|catalog.*download|manual|download.*spec/i.test(clue))add(signals,'document_link',label||href,`a[href="${href}"]`,/\.pdf(?:$|\?)/i.test(href)?'observed':'lead');
    if(/\b(?:page|p|pg)=\d+|\/page\/\d+|\/page-\d+/i.test(href)||/^\d+$/.test(label))add(signals,'pagination',label||href,`a[href="${href}"]`,'lead');
    if(/\b(filter|_sft_|orderby|sort|facet|brand)=/i.test(href))add(signals,'filter_url',href,`a[href="${href}"]`);
    if(/\b(?:fr|de|es|en|it|ja|zh|hi)(?:-[a-z]{2})?\b/i.test(target.pathname.split('/').filter(Boolean)[0]??'')&&(target.pathname.split('/').filter(Boolean)[0]?.length??99)<=5)add(signals,'locale_link',href,`a[href="${href}"]`,'lead');
    if(external&&/catalog|products?|docs?|downloads?|brand|store|shop|division|business|solutions/i.test(clue)&&!/linkedin|facebook|instagram|twitter|youtube|privacy|careers/i.test(clue))add(signals,'cross_host',href,`a[href="${href}"]`,'lead');
  }
  for(const m of html.matchAll(/<form\b([^>]*)>/gi)){
    const a=m[1]??'';if(/search/i.test(a)||/search/i.test(html.slice(m.index,m.index+1000)))add(signals,'search_form','Search form in original HTML','form','lead');
  }
  for(const m of html.matchAll(/<input\b([^>]*)>/gi)){
    const a=m[1]??'';
    if(attr(a,'type')==='search'||/search|part.?number|sku/i.test(attr(a,'name')+' '+attr(a,'placeholder')))add(signals,'search_form','Search or part-number input','input','observed');
    if(/checkbox|range|radio/i.test(attr(a,'type'))&&/filter|facet|product|category|brand/i.test(a))add(signals,'facet_control',trim(a),'input','lead');
  }
  if(/<select\b/i.test(html)&&/filter|sort|category|product|brand|option/i.test(bodyText))add(signals,'facet_control','Select control near product/filter content','select','lead');
  for(const m of html.matchAll(/<(?:button|a)\b[^>]*>([\s\S]*?)<\/(?:button|a)>/gi)){
    const t=plain(m[1]??'');if(/load more|show more|view more|see more/i.test(t))add(signals,'load_more',t,'button/a','lead');
  }
  for(const {inner} of findTags(html,'details'))if(plain(inner).length>40)add(signals,'accordion',plain(inner).slice(0,140),'details');
  if(/aria-expanded|data-accordion|accordion-item/i.test(html)&&/accordion|collapse|expand/i.test(html))add(signals,'accordion_candidate','Accordion interaction indicated by markup','[aria-expanded]','lead');
  if(/aria-label=["'][^"']*breadcrumb|schema\.org\/BreadcrumbList|class=["'][^"']*breadcrumb/i.test(html))add(signals,'breadcrumb','Breadcrumb markup detected','nav/[itemtype=BreadcrumbList]');
  if(/<nav\b/i.test(html)&&links.some(l=>!l.external))add(signals,'navigation','Navigation and internal links present','nav');
  for(const m of html.matchAll(/<link\b([^>]*)>/gi)){
    const a=m[1]??'';if(/alternate/i.test(attr(a,'rel'))&&attr(a,'hreflang'))add(signals,'locale_link',attr(a,'hreflang')+' '+attr(a,'href'),'link[hreflang]');
  }
  if(/iframe\b/i.test(html)&&/catalog|product|configurator|selector/i.test(html))add(signals,'external_embedded_catalog','Embedded catalog/selector iframe candidate','iframe','lead');
  return {url,title,status,contentType,textLength,links:links.slice(0,400),signals};
}
export function analyzePdf(url:string,status=200,contentType='application/pdf'):PageSignals{
  return {url,title:'',status,contentType,textLength:0,links:[],signals:[{type:'pdf_response',excerpt:'PDF content-type observed; document not parsed',locator:'Content-Type',certainty:'observed'}]};
}
