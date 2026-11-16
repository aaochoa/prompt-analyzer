import { detectPromptMode, extractWords, normalizePrompt, toMatchableText } from './normalize.js';
import { gibberishRule } from './rules/gibberish.js';
import { injectionRule } from './rules/injection.js';
import { lengthRule } from './rules/length.js';
import { qualityRule } from './rules/quality.js';
import { secretsPiiRule } from './rules/secrets-pii.js';
import { structureRule } from './rules/structure.js';
import { tokenBudgetRule } from './rules/token-budget.js';
import { countTokens } from './tokenizer.js';
import type {
  AnalysisAction,
  AnalyzerRule,
  AnalysisResult,
  Finding,
  PromptAnalyzerConfig,
  PromptContext,
  ResolvedPromptAnalyzerConfig,
  Severity,
} from './types.js';

export const DEFAULT_RULES: AnalyzerRule[] = [
  lengthRule,
  tokenBudgetRule,
  gibberishRule,
  secretsPiiRule,
  injectionRule,
  qualityRule,
  structureRule,
];

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  redact: 2,
  block: 3,
};

function resolveConfig(config: PromptAnalyzerConfig = {}): ResolvedPromptAnalyzerConfig {
  return {
    minChars: config.minChars ?? 3,
    maxChars: config.maxChars ?? 32_000,
    minWords: config.minWords ?? 2,
    maxTokens: config.maxTokens ?? 4096,
    tokenizerModel: config.tokenizerModel ?? 'gpt-4o',
    customTokenCounter: config.customTokenCounter,
    mode: config.mode ?? 'auto',
    language: config.language ?? 'es',
    piiAction: config.piiAction ?? 'redact',
    secretsAction: config.secretsAction ?? 'block',
    enableRegionalIds: config.enableRegionalIds ?? false,
    injectionWarnThreshold: config.injectionWarnThreshold ?? 35,
    injectionBlockThreshold: config.injectionBlockThreshold ?? 70,
    disabledRules: new Set(config.disabledRules ?? []),
    customRules: config.customRules ?? [],
    blockedTerms: config.blockedTerms ?? [],
    structureCheck: config.structureCheck ?? 'off',
    failFast: config.failFast ?? false,
  };
}

function deriveAction(findings: Finding[]): AnalysisAction {
  let highestRank = 0;
  let action: AnalysisAction = 'allow';

  for (const finding of findings) {
    const rank = SEVERITY_RANK[finding.severity];
    if (rank > highestRank) {
      highestRank = rank;
      if (finding.severity === 'block') action = 'block';
      else if (finding.severity === 'redact') action = 'redact';
      else if (finding.severity === 'warn') action = 'warn';
    }
  }

  return action;
}

export class PromptAnalyzer {
  private readonly config: ResolvedPromptAnalyzerConfig;
  private readonly rules: AnalyzerRule[];

  constructor(config: PromptAnalyzerConfig = {}) {
    this.config = resolveConfig(config);
    this.rules = [
      ...DEFAULT_RULES.filter((rule) => !this.config.disabledRules.has(rule.id)),
      ...this.config.customRules,
    ];
  }

  analyze(rawInput: string): AnalysisResult {
    const start = performance.now();
    const safeInput = typeof rawInput === 'string' ? rawInput : '';
    const norm = normalizePrompt(safeInput);

    const findings: Finding[] = [];
    if (norm.strippedBidiChars > 0) {
      findings.push({
        code: 'BIDI_CHARS_STRIPPED',
        ruleId: 'normalizer',
        severity: 'warn',
        message: `Se eliminaron ${norm.strippedBidiChars} caracteres bidireccionales ocultos.`,
        metadata: { count: norm.strippedBidiChars },
      });
    } else if (norm.strippedControlChars > 0 || norm.strippedZeroWidthChars > 0) {
      findings.push({
        code: 'INVISIBLE_CHARS_STRIPPED',
        ruleId: 'normalizer',
        severity: 'info',
        message: 'Se limpiaron caracteres invisibles o de control del prompt.',
        metadata: {
          controlChars: norm.strippedControlChars,
          zeroWidthChars: norm.strippedZeroWidthChars,
        },
      });
    }

    const detectedMode = detectPromptMode(norm.sanitized, this.config.mode);
    const tokenCount = countTokens(
      norm.sanitized,
      this.config.tokenizerModel,
      this.config.customTokenCounter,
    );

    const ctx: PromptContext = {
      rawInput: safeInput,
      sanitizedPrompt: norm.sanitized,
      matchText: norm.matchText,
      words: extractWords(norm.sanitized),
      matchWords: extractWords(norm.matchText),
      tokenCount,
      mode: detectedMode,
      language: this.config.language,
      config: this.config,
    };

    let riskScore = 0;

    for (const rule of this.rules) {
      const output = rule.run(ctx);
      if (!output) continue;

      if (output.findings && output.findings.length > 0) {
        findings.push(...output.findings);
      }
      if (output.riskDelta) {
        riskScore = Math.min(100, riskScore + output.riskDelta);
      }
      if (output.sanitizedPrompt !== undefined && output.sanitizedPrompt !== ctx.sanitizedPrompt) {
        ctx.sanitizedPrompt = output.sanitizedPrompt;
        ctx.matchText = toMatchableText(output.sanitizedPrompt);
        ctx.words = extractWords(output.sanitizedPrompt);
        ctx.matchWords = extractWords(ctx.matchText);
      }

      if (this.config.failFast && output.findings?.some((f) => f.severity === 'block')) {
        break;
      }
    }

    const action = deriveAction(findings);
    const durationMs = Number((performance.now() - start).toFixed(3));

    return {
      valid: action !== 'block',
      action,
      riskScore,
      sanitizedPrompt: ctx.sanitizedPrompt,
      findings,
      metrics: {
        charCount: ctx.sanitizedPrompt.length,
        wordCount: ctx.words.length,
        tokenCount: ctx.tokenCount,
        durationMs,
        detectedMode,
      },
    };
  }
}

export function createPromptAnalyzer(config?: PromptAnalyzerConfig): PromptAnalyzer {
  return new PromptAnalyzer(config);
}

export function analyzePrompt(input: string, config?: PromptAnalyzerConfig): AnalysisResult {
  return new PromptAnalyzer(config).analyze(input);
}
