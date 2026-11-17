import { getFindingMessage } from '../i18n.js';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

export const tokenBudgetRule: AnalyzerRule = {
    id: 'token-budget',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        const { tokenCount, config, detectedLanguage } = ctx;

        if (tokenCount > config.maxTokens) {
            findings.push({
                code: 'TOKEN_LIMIT_EXCEEDED',
                ruleId: 'token-budget',
                severity: 'block',
                message: getFindingMessage('TOKEN_LIMIT_EXCEEDED', detectedLanguage, {
                    tokenCount,
                    maxTokens: config.maxTokens,
                }),
                metadata: { tokenCount, maxTokens: config.maxTokens },
            });
        } else if (tokenCount > config.maxTokens * 0.9) {
            findings.push({
                code: 'TOKEN_BUDGET_HIGH',
                ruleId: 'token-budget',
                severity: 'warn',
                message: getFindingMessage('TOKEN_BUDGET_HIGH', detectedLanguage, {
                    tokenCount,
                    maxTokens: config.maxTokens,
                }),
                metadata: { tokenCount, maxTokens: config.maxTokens },
            });
        }

        return { findings };
    },
};
