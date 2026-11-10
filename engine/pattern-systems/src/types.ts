export type PatternGroup = 'information' | 'navigation' | 'delivery' | 'technology' | 'method';
export type AssessmentStatus = 'observed' | 'lead' | 'not_observed' | 'not_assessed';
export type RunStatus = 'completed' | 'partial' | 'blocked' | 'failed';
export interface PatternDefinition {
  id: string; name: string; group: PatternGroup; origin: string;
  status: string; definition: string; sourceResearchers: string[];
}
export interface Evidence {
  id: string; patternId?: string; sourceUrl: string;
  signal: string; locator: string; excerpt: string;
  method: 'http-html' | 'http-pdf' | 'http-status' | 'cross-page';
  observedAt: string;
}
export interface LinkRecord { href: string; label: string; external: boolean }
export interface Signal {
  type: string; excerpt: string; locator: string;
  certainty?: 'observed' | 'lead';
}
export interface PageSignals {
  url: string; title: string; status: number; contentType: string;
  textLength: number; contentHash?: string;
  links: LinkRecord[]; signals: Signal[];
}
export interface Assessment {
  patternId: string; status: AssessmentStatus; evidence: Evidence[];
  note: string;
}
export interface Candidate {
  id: string; description: string; sourceUrl: string;
  evidence: string; status: 'review_required';
}
export interface WebsiteAnalysis {
  id: string; companyName?: string; requestedUrl: string; host: string;
  createdAt: string; status: RunStatus; pages: PageSignals[];
  assessments: Assessment[]; candidates: Candidate[];
  errors: string[]; limits: { maxPages: number; inspectedPages: number };
}
export interface FrequencyEntry {
  id: string; name: string; group: PatternGroup;
  observed: number; notObserved: number; leads: number;
  notAssessed: number; assessed: number; prevalence: number | null;
}
