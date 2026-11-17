import type { DetectedLanguage, PromptLanguage, PromptMode } from './types.js';

// Null bytes and ASCII control chars except \t (0x09), \n (0x0A), \r (0x0D)
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// Zero-width and invisible formatting characters often used to bypass filters
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
// Bidirectional text override characters (Trojan Source / obfuscation)
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/g;

export interface NormalizationResult {
    sanitized: string;
    matchText: string;
    fuzzyMatchText: string;
    strippedControlChars: number;
    strippedZeroWidthChars: number;
    strippedBidiChars: number;
}

/**
 * Strips invisible/control/bidi characters, normalizes Unicode to NFC,
 * and builds a diacritic-stripped lowercase shadow copy for matching.
 */
export function normalizePrompt(rawInput: string, mode: PromptMode = 'auto'): NormalizationResult {
    let strippedControlChars = 0;
    let strippedZeroWidthChars = 0;
    let strippedBidiChars = 0;

    let text = rawInput.replace(CONTROL_CHARS_RE, () => {
        strippedControlChars += 1;
        return '';
    });

    text = text.replace(ZERO_WIDTH_RE, () => {
        strippedZeroWidthChars += 1;
        return '';
    });

    text = text.replace(BIDI_OVERRIDE_RE, () => {
        strippedBidiChars += 1;
        return '';
    });

    // Preserve Spanish composed characters (á, é, í, ó, ú, ü, ñ)
    text = text
        .normalize('NFC')
        .replace(/\r\n?/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();

    if (detectPromptMode(text, mode) === 'prose') {
        text = text.replace(/[ \t]{3,}/g, ' ');
    }

    const matchText = toMatchableText(text);
    return {
        sanitized: text,
        matchText,
        fuzzyMatchText: toFuzzyMatchableText(matchText),
        strippedControlChars,
        strippedZeroWidthChars,
        strippedBidiChars,
    };
}

const CONFUSABLES_MAP: Record<string, string> = {
    // Cyrillic lookalikes (lowercase + uppercase)
    '\u0430': 'a',
    '\u0410': 'a', // а, А
    '\u0432': 'b',
    '\u0412': 'b', // в, В
    '\u0435': 'e',
    '\u0415': 'e', // е, Е
    '\u0451': 'e',
    '\u0401': 'e', // ё, Ё
    '\u0456': 'i',
    '\u0406': 'i', // і, І
    '\u0458': 'j',
    '\u0408': 'j', // ј, Ј
    '\u043A': 'k',
    '\u041A': 'k', // к, К
    '\u043C': 'm',
    '\u041C': 'm', // м, М
    '\u043D': 'h',
    '\u041D': 'h', // н, Н
    '\u043E': 'o',
    '\u041E': 'o', // о, О
    '\u0440': 'p',
    '\u0420': 'p', // р, Р
    '\u0441': 'c',
    '\u0421': 'c', // с, С
    '\u0442': 't',
    '\u0422': 't', // т, Т
    '\u0443': 'y',
    '\u0423': 'y', // у, У
    '\u0445': 'x',
    '\u0425': 'x', // х, Х
    '\u044A': 'b',
    '\u042A': 'b', // ъ, Ъ
    // Greek lookalikes
    '\u03B1': 'a',
    '\u0391': 'a', // α, Α
    '\u03B5': 'e',
    '\u0395': 'e', // ε, Ε
    '\u03B9': 'i',
    '\u0399': 'i', // ι, Ι
    '\u03BA': 'k',
    '\u039A': 'k', // κ, Κ
    '\u03BD': 'v',
    '\u039D': 'n', // ν, Ν
    '\u03BF': 'o',
    '\u039F': 'o', // ο, Ο
    '\u03C1': 'p',
    '\u03A1': 'p', // ρ, Ρ
    '\u03C4': 't',
    '\u03A4': 't', // τ, Τ
    '\u03C7': 'x',
    '\u03A7': 'x', // χ, Χ
};

const CONFUSABLES_RE = new RegExp(`[${Object.keys(CONFUSABLES_MAP).join('')}]`, 'gu');

/**
 * Produces a lowercase, diacritic-stripped, homoglyph-folded copy of text
 * for accent- and confusable-insensitive keyword and pattern matching.
 */
export function toMatchableText(text: string): string {
    return text
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(CONFUSABLES_RE, (ch) => CONFUSABLES_MAP[ch] ?? ch)
        .toLowerCase();
}

const LEET_MAP: Record<string, string> = {
    '0': 'o',
    '1': 'i',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '@': 'a',
    $: 's',
};

const LEET_TOKEN_RE = /[\p{L}013457@$]+/gu;
const REPEATED_LETTER_STRETCH_RE = /(\p{L})\1{2,}/gu;

/**
 * Produces a leetspeak-folded, repetition-collapsed copy of already-matchable text
 * for misspelling- and obfuscation-resilient matching.
 */
export function toFuzzyMatchableText(matchableText: string): string {
    const deleeted = matchableText.replace(LEET_TOKEN_RE, (token) => {
        if (!/\p{L}/u.test(token)) {
            return token;
        }
        return token.replace(/[013457@$]/g, (ch) => LEET_MAP[ch] ?? ch);
    });

    return deleeted.replace(REPEATED_LETTER_STRETCH_RE, '$1');
}

/**
 * Extracts Unicode letter words (preserving Spanish ñ and accented vowels).
 */
export function extractWords(text: string): string[] {
    return text.match(/\p{L}+/gu) ?? [];
}

const ES_STOP_WORDS = new Set([
    'el',
    'la',
    'los',
    'las',
    'un',
    'una',
    'unos',
    'unas',
    'de',
    'del',
    'que',
    'y',
    'en',
    'para',
    'con',
    'por',
    'como',
    'pero',
    'tu',
    'tus',
    'mi',
    'mis',
    'es',
    'son',
    'esta',
    'este',
    'esto',
    'sobre',
    'sin',
    'mas',
    'haz',
    'dame',
    'explica',
    'explicame',
    'escribe',
    'actua',
    'hola',
    'buenas',
    'gracias',
]);

const EN_STOP_WORDS = new Set([
    'the',
    'is',
    'are',
    'was',
    'were',
    'and',
    'to',
    'of',
    'in',
    'for',
    'with',
    'you',
    'your',
    'that',
    'this',
    'from',
    'how',
    'what',
    'write',
    'act',
    'please',
    'about',
    'all',
    'not',
    'do',
    'can',
    'hello',
    'thanks',
]);

const SPANISH_SCRIPT_RE = /[ñáéíóúü¿¡]/iu;

/**
 * Deterministically detects whether a prompt is Spanish, English, or mixed (Spanglish).
 */
export function detectPromptLanguage(
    matchWords: string[],
    sanitizedText: string,
    configuredLanguage: PromptLanguage,
): DetectedLanguage {
    if (configuredLanguage === 'es' || configuredLanguage === 'en') {
        return configuredLanguage;
    }

    let esScore = SPANISH_SCRIPT_RE.test(sanitizedText) ? 2 : 0;
    let enScore = 0;

    for (const word of matchWords) {
        if (ES_STOP_WORDS.has(word)) {
            esScore += 1;
        }
        if (EN_STOP_WORDS.has(word)) {
            enScore += 1;
        }
    }

    if (
        esScore >= 2 &&
        enScore >= 2 &&
        Math.min(esScore, enScore) / Math.max(esScore, enScore) >= 0.4
    ) {
        return 'mixed';
    }

    if (enScore > esScore) {
        return 'en';
    }

    return 'es';
}

/**
 * Heuristically detects whether a prompt is primarily code or natural-language prose.
 */
export function detectPromptMode(text: string, configuredMode: PromptMode): 'prose' | 'code' {
    if (configuredMode !== 'auto') {
        return configuredMode;
    }

    if (text.includes('```')) {
        return 'code';
    }

    let codeSignals = 0;
    if (/(=>|===|!==|\bconst\s+\w+|\bfunction\s+\w+|\bimport\s+.*from\b)/.test(text)) {
        codeSignals += 2;
    }
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/im.test(text)) {
        codeSignals += 2;
    }
    if (/<[a-zA-Z][\w-]*(\s+[^>]*)?>[\s\S]*<\/[a-zA-Z][\w-]*>/.test(text)) {
        codeSignals += 1;
    }
    const textWithoutPlaceholders = text.replace(/\{\{\s*[\w.-]+\s*\}\}/g, '');
    const bracesAndSemicolons = (textWithoutPlaceholders.match(/[{};]/g) ?? []).length;
    if (
        bracesAndSemicolons >= 4 &&
        textWithoutPlaceholders.length > 0 &&
        bracesAndSemicolons / textWithoutPlaceholders.length > 0.03
    ) {
        codeSignals += 2;
    }

    return codeSignals >= 2 ? 'code' : 'prose';
}
