import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

export const tokenBudgetRule: AnalyzerRule = {
    id: 'token-budget',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        const { tokenCount, config } = ctx;

        if (tokenCount > config.maxTokens) {
            findings.push({
                code: 'TOKEN_LIMIT_EXCEEDED',
                ruleId: 'token-budget',
                severity: 'block',
                message: `El prompt supera el límite de tokens (${tokenCount} > ${config.maxTokens}).`,
                metadata: { tokenCount, maxTokens: config.maxTokens },
            });
        } else if (tokenCount > config.maxTokens * 0.9) {
            findings.push({
                code: 'TOKEN_BUDGET_HIGH',
                ruleId: 'token-budget',
                severity: 'warn',
                message: `El prompt usa más del 90% del presupuesto de tokens (${tokenCount}/${config.maxTokens}).`,
                metadata: { tokenCount, maxTokens: config.maxTokens },
            });
        }

        return { findings };
    },
};
