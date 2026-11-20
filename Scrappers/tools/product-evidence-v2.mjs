/** CPU-bounded, source-only evidence selection for laptop Ollama.
 * Scan up to 90k extracted characters but send only relevant verbatim excerpts
 * with traceable page origins. No fabricated component or process claims.
 */
const positive=/\b(?:made from|made of|constructed|built with|material|materials|alumin(?:um|ium)|stainless steel|steel|polymer|polycarbonate|titanium|copper|carbon fiber|fiberglass|includes|contains|features|equipped|comes with|assembly|bracket|frame|housing|sensor|controller|motor|bearing|gear|shaft|valve|wiring|battery|specification|technical data|dimensions?|weight|capacity|voltage|power|pressure|flow rate|diameter|length|width|height|tolerance|rpm|torque|sku|part number|manufactured)\b/i;
const caution=/\b(?:not included|not made|sold separately|optional|available separately|without|compatible with|instead of|other products)\b/i;
const technical=/\b(?:[0-9]+(?:\.[0-9]+)?\s*(?:mm|cm|kg|lbs?|amps?|v|vac|vdc|w|kw|psi|bar|rpm|hz)\b|(?:material|voltage|dimensions?|capacity|model|sku|part\s*(?:no|number))\s*:)/i;
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
export function selectProductEvidence(page,productName,{maxChars=5100,maxSourceChars=90_000}={}){
 const content=page?.content||page||{};
 const raw=String(content.text||'').slice(0,maxSourceChars);
 const name=clean(productName).toLowerCase();
 if(maxChars<350||maxChars>8000)throw Error('Evidence budget must be 350–8000 chars');
 const heading=[content.title,...(content.headings||[])].map(clean)
   .filter(x=>x.length>=4).slice(0,4);
 const textLines=raw.split(/\r?\n/),lines=[],seen=new Set();
 const include=(part,pos,origin)=>{
   const value=clean(part).slice(0,460);
   if(value.length<9||seen.has(value.toLowerCase()))return;
   seen.add(value.toLowerCase());
   const lower=value.toLowerCase();
   let score=0;
   if(name&&lower.includes(name))score+=35;
   if(positive.test(value))score+=25;
   if(technical.test(value))score+=22;
   if(/^(?:specifications?|features|materials?|product details|technical data)\b/i.test(value))score+=12;
   if(caution.test(value))score-=20;
   if(origin==='heading')score+=42;
   if(!positive.test(value)&&!technical.test(value)&&origin!=='heading')score-=15;
   const relative=raw.length?pos/raw.length:0;
   lines.push({value,score,origin,position:Math.round(relative*100)});
 };
 for(const h of heading)include(h,0,'heading');
 let cursor=0;
 for(const line of textLines){
   const l=clean(line);
   if(l.length<=460){include(l,cursor,'page');cursor+=line.length+1;continue;}
   // Some websites have one unbroken content string; select bounded windows
   // around relevant signals even at the end of a very long page.
   const pattern=/\b(?:material|aluminium|aluminum|steel|includes|features|equipped|bracket|frame|motor|sensor|part number|dimensions|specification|capacity|pressure|voltage|torque|construction|manufactured)\b/gi;
   let hits=0;
   for(const m of l.matchAll(pattern)){
     const start=Math.max(0,m.index-75),end=Math.min(l.length,m.index+200);
     include(l.slice(start,end),cursor+start,'window');
     if(++hits>=28)break;
   }
   cursor+=line.length+1;
 }
 // Include useful evidence from different regions of the page to reduce
 // header/navigation dominance. All returned excerpts come from source text.
 const selected=[],space=new Set(),push=item=>{
   if(!item||space.has(item.value))return;
   space.add(item.value);selected.push(item);
 };
 for(const h of lines.filter(x=>x.origin==='heading'))push(h);
 const remaining=lines.filter(x=>x.origin!=='heading'&&x.score>=10)
   .sort((a,b)=>b.score-a.score||a.position-b.position);
 for(const bucket of [0,25,50,75]){
   const choice=remaining.find(x=>x.position>=bucket&&x.position<bucket+25);
   if(choice)push(choice);
 }
 for(const row of remaining)push(row);
 if(selected.length<6)
   for(const row of lines.filter(x=>x.origin!=='heading').slice(0,5))push(row);
 const chunks=[],sections=[],overhead=heading.join(' / ').slice(0,180);
 let size=0;
 for(const x of selected){
   if(size+x.value.length+1>maxChars)continue;
   chunks.push(x.value);sections.push({positionPct:x.position,origin:x.origin,
     length:x.value.length,technical:technical.test(x.value)});
   size+=x.value.length+1;
   if(chunks.length>=27)break;
 }
 return {sourceText:chunks.join('\n'),heading:overhead,scannedChars:raw.length,
   selectedChars:size,selection:'ranked_verbatim_evidence_across_page',
   selectedSections:sections};
}
