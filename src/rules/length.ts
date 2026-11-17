import { getFindingMessage } from '../i18n.js';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

export const lengthRule: AnalyzerRule = {
    id: 'length',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        const { sanitizedPrompt, words, config, detectedLanguage } = ctx;

        if (sanitizedPrompt.length === 0) {
            findings.push({
                code: 'EMPTY_PROMPT',
                ruleId: 'length',
                severity: 'block',
                message: getFindingMessage('EMPTY_PROMPT', detectedLanguage),
            });
            return { findings };
        }

        if (sanitizedPrompt.length < config.minChars) {
            findings.push({
                code: 'PROMPT_TOO_SHORT',
                ruleId: 'length',
                severity: 'block',
                message: getFindingMessage('PROMPT_TOO_SHORT', detectedLanguage, {
                    charCount: sanitizedPrompt.length,
                    minChars: config.minChars,
                }),
                metadata: { charCount: sanitizedPrompt.length, minChars: config.minChars },
            });
        }

        if (sanitizedPrompt.length > config.maxChars) {
            findings.push({
                code: 'PROMPT_TOO_LONG',
                ruleId: 'length',
                severity: 'block',
                message: getFindingMessage('PROMPT_TOO_LONG', detectedLanguage, {
                    charCount: sanitizedPrompt.length,
                    maxChars: config.maxChars,
                }),
                metadata: { charCount: sanitizedPrompt.length, maxChars: config.maxChars },
            });
        }

        if (words.length < config.minWords) {
            findings.push({
                code: 'TOO_FEW_WORDS',
                ruleId: 'length',
                severity: 'warn',
                message: getFindingMessage('TOO_FEW_WORDS', detectedLanguage, {
                    wordCount: words.length,
                    minWords: config.minWords,
                }),
                metadata: { wordCount: words.length, minWords: config.minWords },
            });
        }

        return { findings };
    },
};
