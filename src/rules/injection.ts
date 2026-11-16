import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

interface InjectionSignal {
    id: string;
    weight: number;
    pattern: RegExp;
    target: 'match' | 'raw';
}

const INJECTION_SIGNALS: InjectionSignal[] = [
    // Spanish instruction override
    {
        id: 'es_override_instructions',
        weight: 55,
        pattern:
            /\b(?:ignora|descarta|anula|omite|saltate)\s+(?:todas\s+)?(?:las\s+|tus\s+)?(?:instrucciones|reglas|directrices)\s+(?:anteriores|previas|del\s+sistema|de\s+seguridad)\b/,
        target: 'match',
    },
    {
        id: 'es_forget_previous',
        weight: 50,
        pattern: /\bolvida\s+(?:todo\s+)?lo\s+(?:anterior|previo)\b/,
        target: 'match',
    },
    {
        id: 'es_new_persona_hijack',
        weight: 45,
        pattern:
            /\b(?:a\s+partir\s+de\s+ahora\s+(?:eres|actuas|seras)\s+(?:un|una)|nueva\s+instruccion\s*:|olvida\s+(?:el\s+resumen|tus\s+reglas))\b/,
        target: 'match',
    },
    // English instruction override
    {
        id: 'en_override_instructions',
        weight: 55,
        pattern:
            /\b(?:ignore|disregard|override|bypass)\s+(?:all\s+)?(?:(?:previous|prior|your|system|safety)\s+)?(?:instructions|rules|directives|guidelines)\b/,
        target: 'match',
    },
    {
        id: 'en_forget_previous',
        weight: 50,
        pattern: /\bforget\s+everything\s+(?:above|before|you\s+were\s+told)\b/,
        target: 'match',
    },
    {
        id: 'en_new_persona_hijack',
        weight: 45,
        pattern:
            /\b(?:from\s+now\s+on\s+you\s+are|you\s+are\s+no\s+longer\s+(?:a|an)|new\s+instruction\s*:)\b/,
        target: 'match',
    },
    // System prompt exfiltration (ES + EN)
    {
        id: 'es_system_prompt_leak',
        weight: 50,
        pattern:
            /\b(?:muestra|revela|imprime|dime|devuelve|copia)\s+(?:tu|el)\s+(?:system\s+prompt|prompt\s+(?:del\s+sistema|inicial|original)|mensaje\s+del\s+sistema)\b/,
        target: 'match',
    },
    {
        id: 'es_instructions_leak',
        weight: 45,
        pattern:
            /\b(?:muestra|revela|cuales\s+son)\s+tus\s+instrucciones\s+(?:internas|del\s+sistema|originales)\b/,
        target: 'match',
    },
    {
        id: 'en_system_prompt_leak',
        weight: 50,
        pattern:
            /\b(?:reveal|show|print|output|repeat|dump)\s+(?:your\s+)?(?:complete\s+)?(?:system\s+prompt|(?:initial|original|hidden)\s+instructions)\b/,
        target: 'match',
    },
    // Jailbreak / restriction bypass (ES + EN)
    {
        id: 'es_jailbreak_mode',
        weight: 35,
        pattern:
            /\b(?:modo\s+desarrollador|sin\s+restricciones|sin\s+limites\s+eticos|actua\s+como\s+si\s+no\s+tuvieras\s+(?:reglas|filtros))\b/,
        target: 'match',
    },
    {
        id: 'en_jailbreak_mode',
        weight: 35,
        pattern:
            /\b(?:developer\s+mode|jailbreak|godmode|do\s+anything\s+now|without\s+(?:any\s+)?restrictions|unfiltered\s+(?:system|assistant))\b/,
        target: 'match',
    },
    // Chat template token spoofing (high confidence)
    {
        id: 'chat_template_spoofing',
        weight: 70,
        pattern: /(?:<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|endoftext\|>|\[INST\]|\[\/INST\])/,
        target: 'raw',
    },
    // XML / Markdown / RAG document delimiter spoofing (homoglyph-aware via matchText)
    {
        id: 'xml_markdown_delimiter_spoofing',
        weight: 45,
        pattern:
            /(?:<\/?(?:system_instructions|system_override|system_directive|user_input|email_content)(?:\s+[^>\n]{0,80})?>|^\s*###\s*system\s*:|\[system(?:\s+override)?\]\s*:|---\s*(?:end\s+of\s+(?:document|context|text)|fin\s+del\s+(?:documento|texto))\s*---)/m,
        target: 'match',
    },
    // Suspiciously large base64 payload in prose
    {
        id: 'large_base64_payload',
        weight: 30,
        pattern: /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{80,}={0,2}(?![A-Za-z0-9+/=])/,
        target: 'raw',
    },
];

export const injectionRule: AnalyzerRule = {
    id: 'injection',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        const matchedSignals: string[] = [];
        let score = 0;

        for (const signal of INJECTION_SIGNALS) {
            if (signal.id === 'large_base64_payload' && ctx.mode === 'code') {
                continue;
            }

            const targetText = signal.target === 'match' ? ctx.matchText : ctx.sanitizedPrompt;
            if (signal.pattern.test(targetText)) {
                score += signal.weight;
                matchedSignals.push(signal.id);
            }
        }

        const cappedScore = Math.min(100, score);
        const { injectionWarnThreshold, injectionBlockThreshold } = ctx.config;

        if (cappedScore >= injectionBlockThreshold) {
            findings.push({
                code: 'PROMPT_INJECTION_DETECTED',
                ruleId: 'injection',
                severity: 'block',
                riskScore: cappedScore,
                message: 'Se detectó un intento de inyección de instrucciones (prompt injection).',
                metadata: { signals: matchedSignals, score: cappedScore },
            });
        } else if (cappedScore >= injectionWarnThreshold) {
            findings.push({
                code: 'PROMPT_INJECTION_SUSPECTED',
                ruleId: 'injection',
                severity: 'warn',
                riskScore: cappedScore,
                message:
                    'El prompt contiene patrones sospechosos de manipulación de instrucciones.',
                metadata: { signals: matchedSignals, score: cappedScore },
            });
        }

        return {
            findings,
            riskDelta: cappedScore,
        };
    },
};
