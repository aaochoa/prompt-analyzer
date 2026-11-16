import type { TiktokenModel } from 'js-tiktoken';

export type Severity = 'info' | 'warn' | 'redact' | 'block';
export type AnalysisAction = 'allow' | 'warn' | 'redact' | 'block';
export type PromptMode = 'prose' | 'code' | 'auto';
export type PromptLanguage = 'es' | 'en' | 'auto';
export type StructureCheckMode = 'off' | 'advisory' | 'strict';

export interface Finding {
  code: string;
  ruleId: string;
  severity: Severity;
  message: string;
  riskScore?: number;
  metadata?: Record<string, unknown>;
}

export interface PromptAnalyzerConfig {
  minChars?: number;
  maxChars?: number;
  minWords?: number;
  maxTokens?: number;
  tokenizerModel?: TiktokenModel;
  customTokenCounter?: (text: string) => number;
  mode?: PromptMode;
  language?: PromptLanguage;
  piiAction?: 'redact' | 'block' | 'warn';
  secretsAction?: 'block' | 'redact' | 'warn';
  enableRegionalIds?: boolean;
  injectionWarnThreshold?: number;
  injectionBlockThreshold?: number;
  disabledRules?: string[];
  customRules?: AnalyzerRule[];
  blockedTerms?: string[];
  structureCheck?: StructureCheckMode;
  failFast?: boolean;
}

export interface ResolvedPromptAnalyzerConfig {
  minChars: number;
  maxChars: number;
  minWords: number;
  maxTokens: number;
  tokenizerModel: TiktokenModel;
  customTokenCounter?: (text: string) => number;
  mode: PromptMode;
  language: PromptLanguage;
  piiAction: 'redact' | 'block' | 'warn';
  secretsAction: 'block' | 'redact' | 'warn';
  enableRegionalIds: boolean;
  injectionWarnThreshold: number;
  injectionBlockThreshold: number;
  disabledRules: Set<string>;
  customRules: AnalyzerRule[];
  blockedTerms: string[];
  structureCheck: StructureCheckMode;
  failFast: boolean;
}

export interface PromptContext {
  rawInput: string;
  sanitizedPrompt: string;
  matchText: string;
  words: string[];
  matchWords: string[];
  tokenCount: number;
  mode: 'prose' | 'code';
  language: PromptLanguage;
  config: ResolvedPromptAnalyzerConfig;
}

export interface RuleOutput {
  findings?: Finding[];
  sanitizedPrompt?: string;
  riskDelta?: number;
}

export interface AnalyzerRule {
  id: string;
  run(ctx: PromptContext): RuleOutput | void;
}

export interface AnalysisMetrics {
  charCount: number;
  wordCount: number;
  tokenCount: number;
  durationMs: number;
  detectedMode: 'prose' | 'code';
}

export interface AnalysisResult {
  valid: boolean;
  action: AnalysisAction;
  riskScore: number;
  sanitizedPrompt: string;
  findings: Finding[];
  metrics: AnalysisMetrics;
}
