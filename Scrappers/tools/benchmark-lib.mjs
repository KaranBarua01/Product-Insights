/**
 * Site benchmark core. Intentionally Node-only: no Worker bindings, no browser UI.
 * The runner accepts injected strategy/pattern implementations for offline, deterministic tests.
 */
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assertAllowed, normalizeAllowedHosts} from '../dist/safety.js';

export const BENCHMARK_SCHEMA = '1.0';
const VALID_STRATEGIES = new Set(['S01', 'S02', 'S03']);
const VALID_STATUSES = new Set(['completed', 'partial', 'blocked', 'failed', 'unsupported', 'needs_ocr']);

export function parseCsv(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const lines = [];
  let current = '', record = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {current += '"'; i++;}
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') {
      if (current.trim()) throw new Error('Malformed CSV: quote in an unquoted field');
      quoted = true;
    } else if (char === ',') {record.push(current.trim()); current = '';}
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(current.trim());
      if (record.some(value => value.length > 0)) lines.push(record);
      record = []; current = '';
    } else current += char;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  record.push(current.trim());
  if (record.some(value => value.length > 0)) lines.push(record);
  if (!lines.length) throw new Error('CSV is empty');
  const header = lines.shift().map(s => s.toLowerCase().replace(/\s+/g, '_'));
  if (new Set(header).size !== header.length || header.includes('')) throw new Error('CSV contains empty or duplicate headers');
  return lines.map((fields, index) => {
    if (fields.length !== header.length) throw new Error(`CSV row ${index + 2}: expected ${header.length} fields, found ${fields.length}`);
    return Object.fromEntries(header.map((h, i) => [h, fields[i] ?? '']));
  });
}

export function csvEncode(rows) {
  return rows.map(row => row.map(value => {
    const raw = String(value ?? '');
    // Exports often open in spreadsheet apps: never allow site-controlled cells to execute as formulas.
    const safe = /^[\s]*[=+\-@]/.test(raw) ? '\'' + raw : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\n') + '\n';
}
const splitPipe = value => String(value || '').split('|').map(x => x.trim()).filter(Boolean);
const pct = (count, total) => total ? Number((100 * count / total).toFixed(1)) : null;
function nonnegInt(value, fallback, field) {
  if (value === '' || value === undefined || value === null) return fallback;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 0 || v > 50000) throw new Error(`Invalid ${field}: ${value}`);
  return v;
}
const normalized = v => String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function errorText(e) {return String(e instanceof Error ? e.message : e).slice(0,650);}

export function prepareSites(sitesCsv, allowedHostsInput, maxSites = 30) {
  const allowedHosts = normalizeAllowedHosts(allowedHostsInput);
  if (!allowedHosts.length) throw new Error('Approved host allowlist is empty. Use an explicitly reviewed --allow-hosts file.');
  const rows = parseCsv(sitesCsv);
  if (!rows.length) throw new Error('No websites in sites CSV');
  if (!Number.isInteger(maxSites) || maxSites < 1 || maxSites > 30) throw new Error('--max-sites must be 1..30');
  if (rows.length > maxSites) throw new Error(`Input contains ${rows.length} sites; max is ${maxSites}. Choose an approved subset.`);
  const seenIds = new Set(), seenUrls = new Set();
  return rows.map((row, i) => {
    if (!row.url) throw new Error(`Site row ${i + 2}: missing URL`);
    const url = assertAllowed(row.url, allowedHosts).href;
    const id = row.site_id || `SITE-${String(i + 1).padStart(3, '0')}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,59}$/.test(id)) throw new Error(`Invalid site_id at row ${i + 2}`);
    if (seenIds.has(id) || seenUrls.has(url)) throw new Error(`Duplicate site_id or URL at row ${i + 2}`);
    seenIds.add(id); seenUrls.add(url);
    return {siteId: id, companyName: (row.company_name || '').slice(0, 180), url, note: (row.note || '').slice(0, 400)};
  });
}

export function prepareLabels(labelsCsv, sites) {
  if (!labelsCsv) return new Map();
  const rows = parseCsv(labelsCsv);
  const siteIds = new Set(sites.map(s => s.siteId));
  const labels = new Map();
  for (const row of rows) {
    const id = row.site_id;
    if (!id || !siteIds.has(id)) throw new Error(`Label has unknown or missing site_id: ${id || '(empty)'}`);
    if (labels.has(id)) throw new Error(`Duplicate label site_id: ${id}`);
    const reviewed = /^(yes|true|1)$/i.test(row.reviewed || '');
    if ((row.reviewed || '') && !/^(yes|true|1|no|false|0)$/i.test(row.reviewed)) throw new Error(`Invalid reviewed flag for ${id}`);
    const expectedRoute = row.expected_initial_strategy || '';
    const acceptableFinal = splitPipe(row.acceptable_final_strategies);
    const requiredTerms = splitPipe(row.required_terms).map(normalized);
    const expectedStatus = row.expected_status || '';
    if (expectedRoute && !VALID_STRATEGIES.has(expectedRoute)) throw new Error(`Invalid expected_initial_strategy for ${id}`);
    if (acceptableFinal.some(s => !VALID_STRATEGIES.has(s))) throw new Error(`Invalid acceptable_final_strategies for ${id}`);
    if (expectedStatus && !VALID_STATUSES.has(expectedStatus)) throw new Error(`Invalid expected_status for ${id}`);
    const minChars = nonnegInt(row.min_text_chars, null, 'min_text_chars');
    labels.set(id, {reviewed, expectedRoute, acceptableFinal, requiredTerms, expectedStatus, minChars, note:(row.review_notes || '').slice(0, 600)});
  }
  return labels;
}

export function evaluateSite(site, extraction, patternResult, label, options = {}) {
  const minimum = label?.reviewed && label.minChars !== null ? label.minChars : (options.minTextChars ?? 120);
  const text = String(extraction?.content?.text || '');
  const evidence = Array.isArray(extraction?.evidence) ? extraction.evidence : [];
  const attempts = Array.isArray(extraction?.attempts) ? extraction.attempts : [];
  const enoughText = text.trim().length >= minimum;
  // Returning HTTP 200 with boilerplate only is not a successful extraction.
  const usable = extraction?.status === 'completed' && enoughText && evidence.length > 0;
  const eligible = extraction?.status !== 'blocked';
  const reviewed = !!label?.reviewed;
  const initialRoute = extraction?.routing?.strategy || attempts[0]?.strategy || null;
  const predicted = extraction?.strategy || null;
  const terms = reviewed ? (label.requiredTerms || []) : [];
  const matchedTerms = terms.filter(term => normalized(text).includes(term));
  const observedPatterns = (patternResult?.analysis?.assessments || []).filter(v => v.status === 'observed').map(v => v.patternId);
  const leadPatterns = (patternResult?.analysis?.assessments || []).filter(v => v.status === 'lead').map(v => v.patternId);
  const status = extraction?.status || 'failed';
  const failedReason = !usable ? (extraction?.reason || (status === 'completed' ? `Insufficient evidence/content (${text.trim().length} chars, ${evidence.length} evidence)` : 'No extraction result')) : '';
  return {
    siteId: site.siteId, companyName: site.companyName, requestedUrl: site.url,
    sourceUrl: extraction?.sourceUrl || '', status,
    firstStrategy: initialRoute, finalStrategy: predicted,
    patternStatus: patternResult?.status || 'not_assessed',
    patternError: patternResult?.error || '',
    observedPatterns, leadPatterns,
    routingReason: extraction?.routing?.reason || '',
    routingProvenance: extraction?.routing?.provenance || 'none',
    textChars: text.trim().length, title: extraction?.content?.title || '',
    headingCount: extraction?.content?.headings?.length || 0,
    linkCount: extraction?.content?.links?.length || 0,
    pdfLinks: extraction?.content?.documents?.length || 0,
    pdfPages: extraction?.content?.pdfPages?.length || 0,
    evidenceCount: evidence.length,
    evidenceSources: [...new Set(evidence.map(x=>x.sourceUrl).filter(Boolean))].slice(0,20),
    attemptCount: attempts.length,
    attempts,
    extraction,
    usable, eligible, reason: failedReason,
    reviewed,
    expectedInitialStrategy: reviewed ? (label.expectedRoute || null) : null,
    initialStrategyMatches: reviewed && label.expectedRoute && initialRoute ? initialRoute === label.expectedRoute : null,
    acceptableFinalStrategies: reviewed ? label.acceptableFinal : [],
    finalStrategyMatches: reviewed && label.acceptableFinal?.length && predicted ? label.acceptableFinal.includes(predicted) : null,
    expectedStatus: reviewed ? (label.expectedStatus || null) : null,
    statusMatches: reviewed && label.expectedStatus ? label.expectedStatus === status : null,
    requiredTerms: terms,
    matchedTerms,
    termRecall: reviewed && terms.length ? pct(matchedTerms.length, terms.length) : null,
    minTextChars: minimum,
    reviewNote: reviewed ? label.note : '',
    manualReviewNeeded: Boolean(!reviewed || !usable || (reviewed && (label.expectedRoute && label.expectedRoute !== initialRoute || label.expectedStatus && label.expectedStatus !== status || terms.length && matchedTerms.length !== terms.length)))
  };
}

export function summarize(results, config) {
  const count = results.length;
  const statusCounts = Object.fromEntries([...VALID_STATUSES].map(k => [k, results.filter(r => r.status === k).length]));
  const eligible = results.filter(r=>r.eligible);
  const usableEligible = eligible.filter(r=>r.usable);
  const routeLabeled = results.filter(r=>r.initialStrategyMatches !== null);
  const finalLabeled = results.filter(r=>r.finalStrategyMatches !== null);
  const statusLabeled = results.filter(r=>r.statusMatches !== null);
  const termsLabeled = results.filter(r=>r.termRecall !== null);
  const durations = results.map(r=>r.durationMs || 0);
  const sum = values=>values.reduce((a,b)=>a+b,0);
  const fraction = (subset, predicate)=>({correct: subset.filter(predicate).length,labeled: subset.length,accuracyPct:pct(subset.filter(predicate).length,subset.length)});
  return {
    schemaVersion: BENCHMARK_SCHEMA,
    generatedAt: new Date().toISOString(),
    config,
    totalSites: count, statusCounts,
    access: {eligible:eligible.length,blocked:statusCounts.blocked},
    quality: {usable:results.filter(r=>r.usable).length,usableEligible:usableEligible.length,eligible:eligible.length,usableRatePct:pct(usableEligible.length,eligible.length),definition:'status=completed AND >= site min text chars AND >= 1 evidence record'},
    routing: {initial: fraction(routeLabeled,r=>r.initialStrategyMatches === true),final: fraction(finalLabeled,r=>r.finalStrategyMatches === true)},
    labeledStatus: fraction(statusLabeled,r=>r.statusMatches === true),
    keywordCoverage: {labeled:termsLabeled.length,meanRecallPct:termsLabeled.length ? Number((sum(termsLabeled.map(r=>r.termRecall))/termsLabeled.length).toFixed(1)) : null},
    review: {labeled:results.filter(r=>r.reviewed).length,unlabeled:results.filter(r=>!r.reviewed).length,needsReview:results.filter(r=>r.manualReviewNeeded).length},
    effort: {totalAttempts:sum(results.map(r=>r.attemptCount)),totalElapsedMs:sum(durations),meanElapsedMs: count ? Math.round(sum(durations)/count) : null,measuredApiCostUsd:null},
    goals: {usableEligiblePct:90,initialRouteAccuracyPct:85,usableTargetMet:eligible.length ? usableEligible.length / eligible.length >= .9 : null,routeAccuracyTargetMet:routeLabeled.length ? routeLabeled.filter(r=>r.initialStrategyMatches).length / routeLabeled.length >= .85 : null},
    limitations:['Automated usability is a basic proxy, not proof of complete product extraction.','Routing accuracy and keyword recall only use manually reviewed labels.','API charges and browser execution costs are not instrumented.','Live results may be blocked or require permissions; no bypass is attempted.']
  };
}

export async function runBenchmark({sites, labels=new Map(), execute, detectPatterns=async()=>({status:'not_assessed'}), delayMs=1200, minTextChars=120, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), onProgress=()=>{}, config={}}) {
  if (!Array.isArray(sites) || !sites.length || sites.length > 30) throw new Error('Benchmark requires 1–30 sites');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60000) throw new Error('delayMs must be 0..60000');
  const results = [];
  for (const site of sites) {
    if (results.length) await sleep(delayMs);
    const begin = performance.now();
    let patternResult = {status:'not_assessed'};
    try {
      patternResult = await detectPatterns(site);
      if (!patternResult || typeof patternResult !== 'object') throw Error('Invalid pattern result');
    } catch(e) {
      patternResult = {status:'failed',error:errorText(e)};
    }
    let extraction;
    try {
      extraction = await execute(site, patternResult.analysis);
      if (!extraction || typeof extraction !== 'object') throw Error('Extractor returned no result');
    } catch(e) {
      extraction = {status:'failed',reason:errorText(e),content:{},evidence:[],attempts:[],routing:{strategy:null,reason:'Request failed',provenance:'none'},warnings:[errorText(e)]};
    }
    const evaluated = evaluateSite(site, extraction, patternResult, labels.get(site.siteId), {minTextChars});
    evaluated.durationMs = Math.round(performance.now() - begin);
    results.push(evaluated);
    onProgress(evaluated,results.length,sites.length);
  }
  return {summary:summarize(results,config),results};
}

export function buildReviewTemplate(sites) {
  return csvEncode([['site_id','reviewed','expected_initial_strategy','acceptable_final_strategies','expected_status','required_terms','min_text_chars','review_notes'], ...sites.map(s=>[s.siteId,'no','','','','','',''])]);
}

export async function writeArtifacts(outputDirectory, batch) {
  await mkdir(outputDirectory,{recursive:true});
  const summaryPath = join(outputDirectory,'summary.json');
  const resultsPath = join(outputDirectory,'results.json');
  const rows = batch.results;
  await writeFile(summaryPath,JSON.stringify(batch.summary,null,2)+'\n','utf8');
  await writeFile(resultsPath,JSON.stringify({schemaVersion:BENCHMARK_SCHEMA,results:rows},null,2)+'\n','utf8');
  const columns = ['site_id','company_name','url','status','usable','eligible','pattern_status','pattern_error','observed_patterns','lead_patterns','first_strategy','final_strategy','routing_provenance','routing_reason','text_chars','title','heading_count','pdf_links','pdf_pages','evidence_count','evidence_sources','attempts','duration_ms','reviewed','expected_first_strategy','initial_route_matches','final_strategy_matches','status_matches','term_recall_pct','reason'];
  const csvRows = rows.map(r=>[r.siteId,r.companyName,r.requestedUrl,r.status,r.usable,r.eligible,r.patternStatus,r.patternError,r.observedPatterns.join('|'),r.leadPatterns.join('|'),r.firstStrategy,r.finalStrategy,r.routingProvenance,r.routingReason,r.textChars,r.title,r.headingCount,r.pdfLinks,r.pdfPages,r.evidenceCount,r.evidenceSources.join('|'),r.attemptCount,r.durationMs,r.reviewed,r.expectedInitialStrategy,r.initialStrategyMatches,r.finalStrategyMatches,r.statusMatches,r.termRecall,r.reason]);
  await writeFile(join(outputDirectory,'results.csv'),csvEncode([columns,...csvRows]),'utf8');
  const attempts = [];
  for (const r of rows) for (const a of r.attempts) attempts.push([r.siteId,r.requestedUrl,a.strategy,a.status,a.durationMs,a.reason]);
  await writeFile(join(outputDirectory,'attempts.csv'),csvEncode([['site_id','url','strategy','status','duration_ms','reason'],...attempts]),'utf8');
  const review = rows.filter(r=>r.manualReviewNeeded).map(r=>[r.siteId,r.companyName,r.requestedUrl,r.status,r.finalStrategy,r.textChars,r.evidenceCount,r.reason,r.reviewed,r.expectedInitialStrategy,r.routingReason]);
  await writeFile(join(outputDirectory,'review_queue.csv'),csvEncode([['site_id','company_name','url','status','final_strategy','text_chars','evidence_count','reason','reviewed','expected_route','routing_reason'],...review]),'utf8');
  return {summaryPath,resultsPath,resultsCsv:join(outputDirectory,'results.csv'),attemptsCsv:join(outputDirectory,'attempts.csv'),reviewCsv:join(outputDirectory,'review_queue.csv')};
}
