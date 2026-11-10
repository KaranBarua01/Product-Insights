import type {ExtractedContent,ExtractionEvidence,Strategy} from './types.js';
const MAX_HTML=1_500_000;
function decode(s:string):string{
  const names:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'-',mdash:'-',hellip:'...',reg:'(R)',copy:'(C)'};
  return s.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi,(_,token:string)=>{
    if(token[0]==='#'){const hex=token[1]?.toLowerCase()==='x';const n=parseInt(token.slice(hex?2:1),hex?16:10);return Number.isFinite(n)&&n>0&&n<=0x10ffff?String.fromCodePoint(n):' '}
    return names[token.toLowerCase()]??' ';
  });
}
function sanitize(html:string):string{
  return html.replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<\s*(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,' ')
    .replace(/<\s*(nav|footer|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,' ')
    .replace(/<\s*(?:script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*$/gi,' ')
    .replace(/<\s*br\b[^>]*>/gi,'\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|ul|ol)\s*>/gi,'\n');
}
function stripMarkup(s:string):string{return decode(sanitize(s).replace(/<[^>]+>/g,' ')).replace(/[\t ]+/g,' ').replace(/\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim()}
function attr(s:string,name:string):string|undefined{
  const m=new RegExp('(?:^|\\s)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i').exec(s);
  return m?decode(m[1]??m[2]??m[3]??''):undefined;
}
function scripts(html:string,pattern:RegExp,limit:number):unknown[]{
  const result:unknown[]=[];
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!pattern.test(m[1]??''))continue;const raw=(m[2]??'').trim();if(!raw||raw.length>90_000)continue;
    try{result.push(JSON.parse(raw));if(result.length>=limit)break}catch{/* invalid content not recorded */}
  }
  return result;
}
export function parseHtml(htmlInput:string,sourceUrl:string,method:Strategy='S01'):{content:ExtractedContent;evidence:ExtractionEvidence[];warnings:string[]}{
  const html=htmlInput.slice(0,MAX_HTML),warnings:string[]=[];
  if(htmlInput.length>MAX_HTML)warnings.push('HTML truncated during parsing');
  const tm=/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title=tm?stripMarkup(tm[1]??'').slice(0,240):undefined;
  let description:string|undefined;
  for(const m of html.matchAll(/<meta\b([^>]*)>/gi)){
    const a=m[1]??'',key=(attr(a,'name')??attr(a,'property')??'').toLowerCase();
    if(['description','og:description'].includes(key)){description=attr(a,'content')?.slice(0,500);if(description)break}
  }
  const links:{url:string;label:string}[]=[],documents:string[]=[],seen=new Set<string>();
  const base=new URL(sourceUrl);
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const href=attr(m[1]??'','href');if(!href)continue;
    let url:URL;try{url=new URL(href,base)}catch{continue}
    if(!['https:','http:'].includes(url.protocol))continue;url.hash='';
    if(!seen.has(url.href)&&links.length<160){links.push({url:url.href,label:stripMarkup(m[2]??'').slice(0,120)});seen.add(url.href)}
    if(/\.pdf(?:$|\?)/i.test(url.href)&&!documents.includes(url.href)&&documents.length<35)documents.push(url.href);
  }
  const jsonLd=scripts(html,/type\s*=\s*['"]?application\/ld\+json/i,16);
  const appState=scripts(html,/(?:id\s*=\s*['"]?__NEXT_DATA__|type\s*=\s*['"]?application\/json)/i,4);
  // Prefer primary content regions. A bounded regular expression is a heuristic, not a DOM parser.
  const region=/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html)?.[1]
    ??/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(html)?.[1]
    ??/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)?.[1]
    ??/<main\b[^>]*>([\s\S]*)$/i.exec(html)?.[1]
    ??/<article\b[^>]*>([\s\S]*)$/i.exec(html)?.[1]
    ??/<body\b[^>]*>([\s\S]*)$/i.exec(html)?.[1]
    ??html;
  const headings=[...region.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]\s*>/gi)].map(m=>stripMarkup(m[1]??'')).filter(Boolean).slice(0,40).map(s=>s.slice(0,200));
  const text=stripMarkup(region).slice(0,35_000);
  const evidence:ExtractionEvidence[]=[];
  if(title)evidence.push({sourceUrl,locator:'html > head > title',excerpt:title.slice(0,210),method});
  if(headings[0])evidence.push({sourceUrl,locator:'main/section heading',excerpt:headings[0].slice(0,210),method});
  if(jsonLd.length)evidence.push({sourceUrl,locator:'script[type="application/ld+json"]',excerpt:`${jsonLd.length} valid JSON-LD object(s)`,method});
  if(documents.length)evidence.push({sourceUrl,locator:'a[href*=pdf]',excerpt:`${documents.length} PDF link(s) discovered; not downloaded`,method});
  if(text.length>80)evidence.push({sourceUrl,locator:'primary page text',excerpt:text.slice(0,210).replace(/\s+/g,' '),method});
  return {content:{title,description,text,headings,links,documents,jsonLd,appState},evidence,warnings};
}
