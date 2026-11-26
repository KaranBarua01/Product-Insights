export type Strategy = 'S01' | 'S02' | 'S03';
export type Mode = 'auto' | Strategy;
export type ExtractionStatus = 'completed' | 'partial' | 'unsupported' | 'blocked' | 'failed' | 'needs_ocr';
export interface PatternAssessment { patternId: string; status: 'observed' | 'lead' | 'not_observed' | 'not_assessed' }
export interface PatternAnalysis { assessments: PatternAssessment[]; status?: string; requestedUrl?: string }
export interface ExtractRequest { url: string; mode?: Mode; patternAnalysis?: PatternAnalysis; maxPdfPages?: number }
export interface ExtractionEvidence { sourceUrl: string; locator: string; excerpt: string; method: Strategy }
export interface SourcePage {url:string;title?:string; textChars:number; truncated:boolean}
export interface TechnicalTable {
  rows: string[][];
  sourceUrl?: string;
  tableIndex?: number;
  rowMeta?: {cells:{colspan:number;rowspan:number;header:boolean}[]}[];
  hasMergedCells?: boolean;
  truncated?: boolean;
}
export interface PdfLayoutRow {
  y:number;
  cells:{x:number;width:number;text:string}[];
  reviewStatus:'geometry_candidate_requires_review';
}
export interface PdfPageEvidence {
  page:number;
  text:string;
  layoutRows?:PdfLayoutRow[];
  textTruncated?:boolean;
  extractionFailed?:boolean;
  ocrStatus?:'not_needed'|'required'|'review_ready'|'failed'|'not_attempted_budget';
  ocrText?:string;
}
export interface PdfDocumentCoverage {
  totalPages:number|null;
  selectedPages:number[];
  textPages:number[];
  unassessedPages:number|null;
  ocrRequiredPages:number[];
  ocrReviewPages:number[];
  textTruncatedPages:number[];
  byteLength:number;
  byteLimit:number;
  sampling:'all_or_bounded_sample';
}
export interface ExtractedContent {
  title?: string;
  description?: string;
  text?: string;
  headings?: string[];
  links?: { url: string; label: string }[];
  documents?: string[];
  tables?: TechnicalTable[]; // Raw rows; merged-cell geometry is never inferred
  jsonLd?: unknown[];
  appState?: unknown[];
  pdfPages?: PdfPageEvidence[];
  pdfCoverage?: PdfDocumentCoverage;
  sampledPages?: SourcePage[];
  sourceSections?: { sourceUrl:string; title?:string; text:string }[]; // Per-page text with accurate evidence provenance for AI
}
export interface ScrapeAttempt { strategy: Strategy; status: ExtractionStatus; reason: string; durationMs: number }
export interface ScrapeResult {
  schemaVersion: '0.1'; requestedUrl: string; sourceUrl: string; strategy: Strategy;
  status: ExtractionStatus; reason: string; content: ExtractedContent;
  evidence: ExtractionEvidence[]; warnings: string[]; attempts: ScrapeAttempt[];
  routing: { strategy: Strategy; reason: string; patternIds: string[]; provenance: 'supplied' | 'remote' | 'local' | 'none' | 'forced' };
}
export interface ScrapeCore { strategy: Strategy; status: ExtractionStatus; reason: string; sourceUrl: string; content: ExtractedContent; evidence: ExtractionEvidence[]; warnings: string[]; next?: Strategy }
export interface BrowserOutput { html: string; url: string; truncated?: boolean; httpStatus?: number }
export interface PdfParserOutput { pageCount: number; totalPages?: number; truncated?: boolean; pages: PdfPageEvidence[] }
export interface Dependencies {
  fetcher: typeof fetch;
  browser?: (url: string, allowedHosts: readonly string[], robotsRules?: string) => Promise<BrowserOutput>;
  pdfParser?: (bytes: Uint8Array, maxPages: number) => Promise<PdfParserOutput>;
  pdfOcr?: (bytes:Uint8Array,pageNumbers:readonly number[])=>Promise<{page:number;text:string}[]>;
  now?: () => number;
}
export interface ExecutionPolicy { allowedHosts: string[]; timeoutMs?: number; maxBytesHtml?: number; maxBytesPdf?: number; allowLargePdf?:boolean; maxHtmlPages?:number; robotsRules?: string }
