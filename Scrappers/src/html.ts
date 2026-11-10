import type {ExtractedContent, ExtractionEvidence, Strategy} from './types.js';
const TAG_WINDOW=260_000;
function decode(s:string):string{const names:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',reg:'®',copy:'©'};return s.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi,(_,token:string)=>{if(token[0]==='#'){const hex=token[1]?.toLowerCase()==='x';const val=parseInt(token.slice(hex?2:1),hex?16:10);return Number.isFinite(val)&&val>0&&val<=0x10ffff?String.fromCodePoint(val):' ';}return names[token.toLowerCase()]??' ';});}
function stripMarkup(s:string):string{return decode(s.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(?:script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|noscript|svg|template|iframe)\s*>/gi,' ').replace(/<\s*br\b[^>]*>/gi,'\n').replace(/<\/(?:p|div|section|article|li|h[1-6]|tr)\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/[\t ]+/g,' ').replace(/\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n')).trim();}
function attr(html:string,name:string):string|undefined{const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=new RegExp('(?:^|\\s)'+escaped+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i').exec(html);return m?decode(m[1]??m[2]??m[3]??''):undefined;}
function collectScripts(html:string,pattern:RegExp,limit:number):unknown[]{const out:unknown[]=[];for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){const attributes=m[1]||'';if(!pattern.test(attributes))continue;const raw=(m[2]||'').trim();if(!raw || raw.length>80_000)continue;try{const json:unknown=JSON.parse(raw);out.push(json);if(out.length>=limit)break;}catch{/* bad JSON is not evidence */}}return out;}
function asSnippet(text:string,max=240){return text.replace(/\s+/g,' ').trim().slice(0,max);}
export function parseHtml(htmlInput:string,sourceUrl:string,method:Strategy='S01'):{content:ExtractedContent;evidence:ExtractionEvidence[];warnings:string[]}{
  const html=htmlInput.slice(0,TAG_WINDOW);const warnings:string[]=[];if(htmlInput.length>TAG_WINDOW)warnings.push('HTML truncated for bounded parsing');
  const titleMatch=/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title=titleMatch?stripMarkup(titleMatch[1]??'').slice(0,250):undefined;
  let description:string|undefined;
  for(const m of html.matchAll(/<meta\b([^>]*)>/gi)){const a=m[1]||'';if(['description','og:description'].includes((attr(a,'name')??attr(a,'property')??'').toLowerCase())){description=attr(a,'content')?.slice(0,500);if(description)break;}}
  const headings=[...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]\s*>/gi)].map(m=>stripMarkup(m[1]??'')).filter(Boolean).slice(0,35).map(x=>x.slice(0,200));
  const links:{url:string;label:string}[]=[];const docs:string[]=[];const seen=new Set<string>();let base:URL;try{base=new URL(sourceUrl)}catch{base=new URL('https://unavailable.invalid')}
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const href=attr(m[1]||'','href');if(!href)continue;let u:URL;try{u=new URL(href,base)}catch{continue}if(!['http:','https:'].includes(u.protocol))continue;u.hash='';const link=u.href;
    if(!seen.has(link)&&links.length<70){seen.add(link);links.push({url:link,label:stripMarkup(m[2]??'').slice(0,120)});}
    if(/\.pdf(?:$|\?)/i.test(link) && !docs.includes(link) && docs.length<25)docs.push(link);
  }
  const jsonLd=collectScripts(html,/type\s*=\s*['"]?application\/ld\+json/i,12);
  const appState=collectScripts(html,/(?:id\s*=\s*['"]?__NEXT_DATA__|type\s*=\s*['"]?application\/json)/i,3);
  const main=/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1];
  const text=stripMarkup(main??html).slice(0,20_000);
  const evidence:ExtractionEvidence[]=[];
  if(title)evidence.push({sourceUrl,locator:'html > head > title',excerpt:asSnippet(title),method});
  if(headings[0])evidence.push({sourceUrl,locator:'h1..h4 (first)',excerpt:asSnippet(headings[0]),method});
  if(jsonLd.length)evidence.push({sourceUrl,locator:'script[type="application/ld+json"]',excerpt:`${jsonLd.length} JSON-LD document(s) parsed`,method});
  if(docs.length)evidence.push({sourceUrl,locator:'a[href$=".pdf"]',excerpt:`${docs.length} PDF link(s) observed, not downloaded`,method});
  return {content:{title,description,text,headings,links,documents:docs,jsonLd,appState},evidence,warnings};
}
