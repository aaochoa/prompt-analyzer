import type { PromptMode } from './types.js';

// Null bytes and ASCII control chars except \t (0x09), \n (0x0A), \r (0x0D)
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// Zero-width and invisible formatting characters often used to bypass filters
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g;
// Bidirectional text override characters (Trojan Source / obfuscation)
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/g;

export interface NormalizationResult {
    sanitized: string;
    matchText: string;
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

    return {
        sanitized: text,
        matchText: toMatchableText(text),
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

/**
 * Extracts Unicode letter words (preserving Spanish ñ and accented vowels).
 */
export function extractWords(text: string): string[] {
    return text.match(/\p{L}+/gu) ?? [];
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
