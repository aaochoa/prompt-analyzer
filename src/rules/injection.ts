import { getFindingMessage } from '../i18n.js';
import { toMatchableText } from '../normalize.js';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';
import { isFuzzyWordMatch } from '../utils.js';

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

const OVERRIDE_VERBS = [
    'ignora',
    'descarta',
    'anula',
    'omite',
    'saltate',
    'olvida',
    'ignore',
    'disregard',
    'override',
    'bypass',
    'forget',
] as const;

const OVERRIDE_TARGETS = [
    'instrucciones',
    'reglas',
    'directrices',
    'indicaciones',
    'instructions',
    'rules',
    'directives',
    'guidelines',
] as const;

const OVERRIDE_SCOPES = [
    'anteriores',
    'previas',
    'previo',
    'anterior',
    'sistema',
    'seguridad',
    'previous',
    'prior',
    'system',
    'safety',
    'todas',
    'todo',
    'all',
] as const;

const LEAK_VERBS = [
    'muestra',
    'revela',
    'imprime',
    'dime',
    'devuelve',
    'copia',
    'reveal',
    'show',
    'print',
    'output',
    'repeat',
    'dump',
] as const;

const LEAK_SYSTEM_QUALIFIERS = [
    'sistema',
    'inicial',
    'original',
    'originales',
    'internas',
    'system',
    'initial',
    'hidden',
    'original',
] as const;

function matchesAnyFuzzy(word: string, targets: readonly string[]): boolean {
    return targets.some((target) => isFuzzyWordMatch(word, target));
}

function hasWindowMatch(
    words: string[],
    startIdx: number,
    maxOffset: number,
    targets: readonly string[],
): number {
    const limit = Math.min(words.length - 1, startIdx + maxOffset);
    for (let j = startIdx + 1; j <= limit; j += 1) {
        const w = words[j];
        if (w !== undefined && matchesAnyFuzzy(w, targets)) {
            return j;
        }
    }
    return -1;
}

function detectFuzzyBilingualOverride(words: string[]): boolean {
    for (let i = 0; i < words.length; i += 1) {
        const verb = words[i];
        if (verb === undefined || !matchesAnyFuzzy(verb, OVERRIDE_VERBS)) {
            continue;
        }
        const targetIdx = hasWindowMatch(words, i, 6, OVERRIDE_TARGETS);
        if (targetIdx === -1) {
            continue;
        }
        const hasScopeAfterVerb = hasWindowMatch(words, i, 7, OVERRIDE_SCOPES) !== -1;
        if (hasScopeAfterVerb) {
            return true;
        }
    }
    return false;
}

function detectFuzzyBilingualLeak(words: string[]): boolean {
    for (let i = 0; i < words.length; i += 1) {
        const verb = words[i];
        if (verb === undefined || !matchesAnyFuzzy(verb, LEAK_VERBS)) {
            continue;
        }
        const promptOrInstrIdx = hasWindowMatch(words, i, 6, [
            'prompt',
            'instrucciones',
            'instructions',
        ]);
        if (promptOrInstrIdx === -1) {
            continue;
        }
        const windowStart = Math.max(i + 1, promptOrInstrIdx - 2);
        const windowEnd = Math.min(words.length - 1, promptOrInstrIdx + 3);
        for (let j = windowStart; j <= windowEnd; j += 1) {
            const q = words[j];
            if (q !== undefined && matchesAnyFuzzy(q, LEAK_SYSTEM_QUALIFIERS)) {
                return true;
            }
        }
    }
    return false;
}

function detectFuzzyBilingualJailbreak(words: string[]): boolean {
    for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        if (word === undefined) continue;
        if (isFuzzyWordMatch(word, 'jailbreak') || isFuzzyWordMatch(word, 'godmode')) {
            return true;
        }
        if (
            (isFuzzyWordMatch(word, 'modo') || isFuzzyWordMatch(word, 'mode')) &&
            hasWindowMatch(words, i, 2, ['desarrollador', 'developer']) !== -1
        ) {
            return true;
        }
        if (
            (word === 'sin' || isFuzzyWordMatch(word, 'without')) &&
            hasWindowMatch(words, i, 2, ['restricciones', 'restrictions']) !== -1
        ) {
            return true;
        }
    }
    return false;
}

const BASE64_CANDIDATE_RE = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/g;

function decodePrintableBase64Payloads(text: string): string[] {
    const decodedList: string[] = [];
    const matches = text.match(BASE64_CANDIDATE_RE);
    if (!matches) {
        return decodedList;
    }

    for (const token of matches.slice(0, 5)) {
        if (token.length % 4 !== 0) {
            continue;
        }
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (decoded.length < 12 || decoded.includes('\uFFFD')) {
            continue;
        }
        const printableCount = (decoded.match(/[\p{L}\p{N}\p{P}\p{S}\s]/gu) ?? []).length;
        if (printableCount / decoded.length >= 0.85) {
            decodedList.push(decoded);
        }
    }

    return decodedList;
}

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

        const matchedSet = new Set(matchedSignals);

        if (ctx.mode !== 'code') {
            const decodedPayloads = decodePrintableBase64Payloads(ctx.sanitizedPrompt);
            for (const decoded of decodedPayloads) {
                const decodedMatchText = toMatchableText(decoded);
                let foundInDecoded = false;
                for (const signal of INJECTION_SIGNALS) {
                    if (signal.id === 'large_base64_payload') {
                        continue;
                    }
                    const targetText = signal.target === 'match' ? decodedMatchText : decoded;
                    if (signal.pattern.test(targetText)) {
                        foundInDecoded = true;
                        if (!matchedSet.has(signal.id)) {
                            score += signal.weight;
                            matchedSet.add(signal.id);
                            matchedSignals.push(signal.id);
                        }
                    }
                }
                if (foundInDecoded && !matchedSet.has('base64_decoded_injection')) {
                    score += 20;
                    matchedSet.add('base64_decoded_injection');
                    matchedSignals.push('base64_decoded_injection');
                }
            }
        }
        if (
            !matchedSet.has('es_override_instructions') &&
            !matchedSet.has('en_override_instructions') &&
            detectFuzzyBilingualOverride(ctx.fuzzyWords)
        ) {
            score += 55;
            matchedSignals.push('bilingual_fuzzy_override');
        }

        if (
            !matchedSet.has('es_system_prompt_leak') &&
            !matchedSet.has('es_instructions_leak') &&
            !matchedSet.has('en_system_prompt_leak') &&
            detectFuzzyBilingualLeak(ctx.fuzzyWords)
        ) {
            score += 50;
            matchedSignals.push('bilingual_fuzzy_prompt_leak');
        }

        if (
            !matchedSet.has('es_jailbreak_mode') &&
            !matchedSet.has('en_jailbreak_mode') &&
            detectFuzzyBilingualJailbreak(ctx.fuzzyWords)
        ) {
            score += 35;
            matchedSignals.push('bilingual_fuzzy_jailbreak');
        }

        const cappedScore = Math.min(100, score);
        const { injectionWarnThreshold, injectionBlockThreshold } = ctx.config;

        if (cappedScore >= injectionBlockThreshold) {
            findings.push({
                code: 'PROMPT_INJECTION_DETECTED',
                ruleId: 'injection',
                severity: 'block',
                riskScore: cappedScore,
                message: getFindingMessage('PROMPT_INJECTION_DETECTED', ctx.detectedLanguage),
                metadata: { signals: matchedSignals, score: cappedScore },
            });
        } else if (cappedScore >= injectionWarnThreshold) {
            findings.push({
                code: 'PROMPT_INJECTION_SUSPECTED',
                ruleId: 'injection',
                severity: 'warn',
                riskScore: cappedScore,
                message: getFindingMessage('PROMPT_INJECTION_SUSPECTED', ctx.detectedLanguage),
                metadata: { signals: matchedSignals, score: cappedScore },
            });
        }

        return {
            findings,
            riskDelta: cappedScore,
        };
    },
};
