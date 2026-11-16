import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

export const lengthRule: AnalyzerRule = {
  id: 'length',
  run(ctx: PromptContext) {
    const findings: Finding[] = [];
    const { sanitizedPrompt, words, config } = ctx;

    if (sanitizedPrompt.length === 0) {
      findings.push({
        code: 'EMPTY_PROMPT',
        ruleId: 'length',
        severity: 'block',
        message: 'El prompt está vacío o solo contiene espacios en blanco.',
      });
      return { findings };
    }

    if (sanitizedPrompt.length < config.minChars) {
      findings.push({
        code: 'PROMPT_TOO_SHORT',
        ruleId: 'length',
        severity: 'block',
        message: `El prompt es demasiado corto (${sanitizedPrompt.length} caracteres; mínimo ${config.minChars}).`,
        metadata: { charCount: sanitizedPrompt.length, minChars: config.minChars },
      });
    }

    if (sanitizedPrompt.length > config.maxChars) {
      findings.push({
        code: 'PROMPT_TOO_LONG',
        ruleId: 'length',
        severity: 'block',
        message: `El prompt excede el máximo permitido (${sanitizedPrompt.length} caracteres; máximo ${config.maxChars}).`,
        metadata: { charCount: sanitizedPrompt.length, maxChars: config.maxChars },
      });
    }

    if (words.length < config.minWords) {
      findings.push({
        code: 'TOO_FEW_WORDS',
        ruleId: 'length',
        severity: 'warn',
        message: `El prompt tiene muy pocas palabras (${words.length}; mínimo recomendado ${config.minWords}).`,
        metadata: { wordCount: words.length, minWords: config.minWords },
      });
    }

    return { findings };
  },
};
