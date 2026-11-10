export type Strategy = 'S01' | 'S02' | 'S03';
export type Mode = 'auto' | Strategy;
export type ExtractionStatus = 'completed' | 'partial' | 'unsupported' | 'blocked' | 'failed' | 'needs_ocr';
export interface PatternAssessment { patternId: string; status: 'observed' | 'lead' | 'not_observed' | 'not_assessed' }
export interface PatternAnalysis { assessments: PatternAssessment[]; status?: string; requestedUrl?: string }
export interface ExtractRequest { url: string; mode?: Mode; patternAnalysis?: PatternAnalysis; maxPdfPages?: number }
export interface ExtractionEvidence { sourceUrl: string; locator: string; excerpt: string; method: Strategy }
export interface SourcePage {url:string;title?:string; textChars:number; truncated:boolean}
export interface ExtractedContent {
  title?: string;
  description?: string;
  text?: string;
  headings?: string[];
  links?: { url: string; label: string }[];
  documents?: string[];
  jsonLd?: unknown[];
  appState?: unknown[];
  pdfPages?: { page: number; text: string }[];
  sampledPages?: SourcePage[];
}
export interface ScrapeAttempt { strategy: Strategy; status: ExtractionStatus; reason: string; durationMs: number }
export interface ScrapeResult {
  schemaVersion: '0.1'; requestedUrl: string; sourceUrl: string; strategy: Strategy;
  status: ExtractionStatus; reason: string; content: ExtractedContent;
  evidence: ExtractionEvidence[]; warnings: string[]; attempts: ScrapeAttempt[];
  routing: { strategy: Strategy; reason: string; patternIds: string[]; provenance: 'supplied' | 'remote' | 'local' | 'none' | 'forced' };
}
export interface ScrapeCore { strategy: Strategy; status: ExtractionStatus; reason: string; sourceUrl: string; content: ExtractedContent; evidence: ExtractionEvidence[]; warnings: string[]; next?: Strategy }
export interface BrowserOutput { html: string; url: string; truncated?: boolean }
export interface PdfParserOutput { pageCount: number; pages: { page: number; text: string }[] }
export interface Dependencies {
  fetcher: typeof fetch;
  browser?: (url: string, allowedHosts: readonly string[], robotsRules?: string) => Promise<BrowserOutput>;
  pdfParser?: (bytes: Uint8Array, maxPages: number) => Promise<PdfParserOutput>;
  now?: () => number;
}
export interface ExecutionPolicy { allowedHosts: string[]; timeoutMs?: number; maxBytesHtml?: number; maxBytesPdf?: number; maxHtmlPages?:number; robotsRules?: string }
