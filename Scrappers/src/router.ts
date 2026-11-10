import type {ExtractRequest,PatternAnalysis,Strategy} from './types.js';
export function chooseStrategy(request:ExtractRequest,provenance:'supplied'|'remote'|'none'='none'):{strategy:Strategy;reason:string;patternIds:string[];provenance:'supplied'|'remote'|'none'|'forced'} {
  const analysis:PatternAnalysis|undefined=request.patternAnalysis;
  const patterns=analysis?.assessments.filter(x=>x.status==='observed'||x.status==='lead').map(x=>x.patternId)??[];
  if(request.mode && request.mode!=='auto') return {strategy:request.mode,reason:'Explicit prototype strategy override',patternIds:patterns,provenance:'forced'};
  if(/\.pdf(?:$|\?)/i.test(request.url))return {strategy:'S03',reason:'Requested URL is a PDF',patternIds:patterns,provenance};
  const strong=new Set(analysis?.assessments.filter(x=>x.status==='observed').map(x=>x.patternId)??[]);
  const lead=new Set(patterns);
  // Hydration alone is not proof the page requires a browser: test HTTP first.
  if(lead.has('R04')&&(lead.has('R07')||lead.has('N11'))){return {strategy:'S02',reason:'Sparse app shell combined with hydration or interaction lead',patternIds:patterns,provenance};}
  if(strong.has('R05') && !strong.has('R01') && !strong.has('R02')) return {strategy:'S01',reason:'PDF may be linked, but page content should be sampled before downloading documents',patternIds:patterns,provenance};
  return {strategy:'S01',reason:analysis?'HTTP first; detectable HTML/structured data or unverified browser need':'No pattern assessment supplied; conservative HTTP first',patternIds:patterns,provenance};
}
