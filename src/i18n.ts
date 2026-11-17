import type { DetectedLanguage } from './types.js';

export type UiLanguage = 'es' | 'en';

export function resolveUiLanguage(detectedLanguage: DetectedLanguage): UiLanguage {
    return detectedLanguage === 'en' ? 'en' : 'es';
}

const MESSAGES: Record<string, { es: string; en: string }> = {
    BIDI_CHARS_STRIPPED: {
        es: 'Se eliminaron {count} caracteres bidireccionales ocultos.',
        en: 'Stripped {count} hidden bidirectional control characters.',
    },
    INVISIBLE_CHARS_STRIPPED: {
        es: 'Se limpiaron caracteres invisibles o de control del prompt.',
        en: 'Stripped invisible or control characters from the prompt.',
    },
    EMPTY_PROMPT: {
        es: 'El prompt está vacío o solo contiene espacios en blanco.',
        en: 'The prompt is empty or contains only whitespace.',
    },
    PROMPT_TOO_SHORT: {
        es: 'El prompt es demasiado corto ({charCount} caracteres; mínimo {minChars}).',
        en: 'The prompt is too short ({charCount} characters; minimum {minChars}).',
    },
    PROMPT_TOO_LONG: {
        es: 'El prompt excede el máximo permitido ({charCount} caracteres; máximo {maxChars}).',
        en: 'The prompt exceeds the maximum allowed length ({charCount} characters; maximum {maxChars}).',
    },
    TOO_FEW_WORDS: {
        es: 'El prompt tiene muy pocas palabras ({wordCount}; mínimo recomendado {minWords}).',
        en: 'The prompt has too few words ({wordCount}; recommended minimum {minWords}).',
    },
    TOKEN_LIMIT_EXCEEDED: {
        es: 'El prompt supera el límite de tokens ({tokenCount} > {maxTokens}).',
        en: 'The prompt exceeds the token limit ({tokenCount} > {maxTokens}).',
    },
    TOKEN_BUDGET_HIGH: {
        es: 'El prompt usa más del 90% del presupuesto de tokens ({tokenCount}/{maxTokens}).',
        en: 'The prompt uses more than 90% of the token budget ({tokenCount}/{maxTokens}).',
    },
    REPEATED_CHARACTERS: {
        es: 'El prompt contiene repeticiones excesivas de un mismo carácter.',
        en: 'The prompt contains excessive repetitions of a single character.',
    },
    REPETITIVE_SPAM: {
        es: 'El prompt contiene texto altamente repetitivo o spam.',
        en: 'The prompt contains highly repetitive text or spam.',
    },
    LOW_LEXICAL_DIVERSITY: {
        es: 'El prompt repite las mismas palabras de forma excesiva.',
        en: 'The prompt repeats the same words excessively.',
    },
    EXCESSIVE_SYMBOLS: {
        es: 'El prompt contiene demasiados símbolos no textuales.',
        en: 'The prompt contains too many non-textual symbols.',
    },
    GIBBERISH_LOW_VOWELS: {
        es: 'El texto no parece lenguaje natural (proporción de vocales demasiado baja).',
        en: 'The text does not look like natural language (vowel ratio is too low).',
    },
    GIBBERISH_KEYBOARD_MASH: {
        es: 'El texto contiene secuencias de consonantes improbables (posible texto aleatorio).',
        en: 'The text contains unlikely consonant sequences (possible keyboard mash).',
    },
    PROMPT_INJECTION_DETECTED: {
        es: 'Se detectó un intento de inyección de instrucciones (prompt injection).',
        en: 'A prompt injection attempt was detected.',
    },
    PROMPT_INJECTION_SUSPECTED: {
        es: 'El prompt contiene patrones sospechosos de manipulación de instrucciones.',
        en: 'The prompt contains suspicious instruction-manipulation patterns.',
    },
    BLOCKED_TERM_DETECTED: {
        es: 'El prompt contiene términos bloqueados por la política configurada.',
        en: 'The prompt contains terms blocked by the configured policy.',
    },
    UNRENDERED_PLACEHOLDER: {
        es: 'El prompt parece contener marcadores de plantilla sin reemplazar.',
        en: 'The prompt appears to contain unrendered template placeholders.',
    },
    LOW_INTENT_FILLER: {
        es: 'El prompt solo contiene un saludo o texto de relleno sin una petición clara.',
        en: 'The prompt only contains a greeting or filler text without a clear request.',
    },
    VAGUE_PROMPT: {
        es: 'El prompt es demasiado ambiguo o carece de contexto y dirección específica.',
        en: 'The prompt is too vague or lacks specific context and direction.',
    },
    LOW_PROSE_DIVERSITY: {
        es: 'El prompt tiene poca variedad de palabras para su longitud.',
        en: 'The prompt has low word variety for its length.',
    },
    REPEATED_PHRASE_PADDING: {
        es: 'El prompt repite fragmentos idénticos varias veces.',
        en: 'The prompt repeats identical fragments multiple times.',
    },
    PROMPT_STRUCTURE_INCOMPLETE: {
        es: 'El prompt cubre {score} de {maxScore} elementos recomendados ({missing} pendiente).',
        en: 'The prompt covers {score} of {maxScore} recommended elements (missing: {missing}).',
    },
    PII_EMAIL_DETECTED: {
        es: 'Se detectaron {count} correo(s) electrónico(s).',
        en: 'Detected {count} email address(es).',
    },
    PII_CREDIT_CARD_DETECTED: {
        es: 'Se detectaron {count} número(s) de tarjeta válidos.',
        en: 'Detected {count} valid credit card number(s).',
    },
    PII_PHONE_DETECTED: {
        es: 'Se detectaron {count} número(s) de teléfono.',
        en: 'Detected {count} phone number(s).',
    },
    PII_REGIONAL_ID_DETECTED: {
        es: 'Se detectaron {count} documento(s) de identidad nacional.',
        en: 'Detected {count} national ID document(s).',
    },
};

/**
 * Resolves a localized finding message for the detected prompt language.
 */
export function getFindingMessage(
    code: string,
    detectedLanguage: DetectedLanguage,
    params: Record<string, string | number> = {},
): string {
    const uiLang = resolveUiLanguage(detectedLanguage);
    const template = MESSAGES[code]?.[uiLang] ?? code;
    return template.replace(/\{(\w+)\}/g, (_full, key: string) => {
        const value = params[key];
        return value !== undefined ? String(value) : `{${key}}`;
    });
}
