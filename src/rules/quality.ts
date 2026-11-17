import { getFindingMessage } from '../i18n.js';
import { toFuzzyMatchableText, toMatchableText } from '../normalize.js';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';
import { isFuzzyWordMatch } from '../utils.js';

const FILLER_WORDS = new Set([
    'hola',
    'buenas',
    'buenos',
    'dias',
    'tardes',
    'noches',
    'que',
    'tal',
    'hey',
    'hello',
    'hi',
    'ok',
    'okay',
    'vale',
    'listo',
    'gracias',
    'muchas',
    'test',
    'testing',
    'prueba',
    'probando',
    'si',
    'no',
    'yes',
    'nope',
    'ey',
    'alo',
    'thanks',
    'thank',
    'please',
    'morning',
    'evening',
    'bye',
    'sure',
    'cool',
]);

const FILLER_WORDS_LIST = [...FILLER_WORDS];

const VAGUE_STOP_AND_DEICTIC_WORDS = new Set([
    // Spanish pronouns, determiners, prepositions, generic nouns & auxiliaries
    'el',
    'la',
    'los',
    'las',
    'un',
    'una',
    'unos',
    'unas',
    'lo',
    'le',
    'les',
    'me',
    'te',
    'se',
    'nos',
    'mi',
    'mis',
    'tu',
    'tus',
    'su',
    'sus',
    'de',
    'del',
    'al',
    'en',
    'con',
    'para',
    'por',
    'sobre',
    'acerca',
    'y',
    'o',
    'a',
    'esto',
    'eso',
    'aquello',
    'este',
    'esta',
    'ese',
    'esa',
    'algo',
    'nada',
    'todo',
    'cosa',
    'cosas',
    'tema',
    'asunto',
    'informacion',
    'info',
    'detalles',
    'mas',
    'mejor',
    'favor',
    'puedes',
    'podrias',
    'necesito',
    'quiero',
    'como',
    'que',
    'cual',
    // English pronouns, determiners, prepositions, generic nouns & auxiliaries
    'the',
    'a',
    'an',
    'it',
    'this',
    'that',
    'these',
    'those',
    'something',
    'anything',
    'everything',
    'stuff',
    'thing',
    'things',
    'topic',
    'details',
    'more',
    'better',
    'with',
    'for',
    'about',
    'on',
    'in',
    'to',
    'of',
    'and',
    'or',
    'my',
    'your',
    'me',
    'some',
    'any',
    'can',
    'you',
    'could',
    'would',
    'need',
    'want',
    'how',
    'what',
    'which',
    // Generic request verbs without domain specificity
    'ayuda',
    'ayudame',
    'ayudar',
    'haz',
    'hazme',
    'hacer',
    'revisa',
    'mejora',
    'cambia',
    'explica',
    'explicame',
    'dime',
    'dame',
    'muestra',
    'resume',
    'analiza',
    'arregla',
    'corrige',
    'crea',
    'genera',
    'escribe',
    'help',
    'fix',
    'improve',
    'do',
    'make',
    'check',
    'review',
    'explain',
    'tell',
    'give',
    'show',
    'summarize',
    'analyze',
    'update',
    'change',
    'create',
    'write',
]);

const MAX_WORDS_FOR_VAGUENESS = 12;

const MUSTACHE_OR_ANGLE_PLACEHOLDER_RE =
    /(?:\{\{\s*[\p{L}_][\p{L}\p{N}_.-]*\s*\}\}|<(?:INSERT|TU|YOUR)[_ ][\p{L}_ ]+>)/u;
const BRACKET_SEGMENT_RE = /\[([^[\n\]]{2,120})\]/gu;
const ALLOWED_BRACKET_MARKER_RE = /^(?:FALTA|SUPUESTO|PENDIENTE|REDACTED_[A-Z_]+)\b/iu;
const UPPERCASE_BRACKET_PLACEHOLDER_RE = /^(?:INSERT|TU|YOUR)[_ ][\p{L}_ ]+$/u;
const SPANISH_TEMPLATE_PLACEHOLDER_RE =
    /^(?:pega |tu |que:|quien |en una |en dos |comparte |escribe |inserta |indica |pon |reemplaza |nombre |rol |una linea|paso propio|como quieres)/u;
const ENGLISH_TEMPLATE_PLACEHOLDER_RE =
    /^(?:paste |your |write |insert |enter |replace |describe |name |role |one line|two lines|step |topic\b)/u;

const MIN_WORDS_FOR_PROSE_DIVERSITY = 25;
const MIN_PROSE_UNIQUE_WORD_RATIO = 0.45;
const MIN_PROSE_DISTINCT_WORDS = 12;
const PADDING_SUBSTRING_LENGTH = 20;
const PADDING_MAX_REPEATS = 3;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasUnrenderedPlaceholder(text: string): boolean {
    if (MUSTACHE_OR_ANGLE_PLACEHOLDER_RE.test(text)) {
        return true;
    }

    for (const match of text.matchAll(BRACKET_SEGMENT_RE)) {
        const inner = match[1]?.trim();
        if (!inner || ALLOWED_BRACKET_MARKER_RE.test(inner)) {
            continue;
        }
        if (UPPERCASE_BRACKET_PLACEHOLDER_RE.test(inner)) {
            return true;
        }
        const normalizedInner = toMatchableText(inner);
        if (
            SPANISH_TEMPLATE_PLACEHOLDER_RE.test(normalizedInner) ||
            ENGLISH_TEMPLATE_PLACEHOLDER_RE.test(normalizedInner)
        ) {
            return true;
        }
    }

    return false;
}

function hasRepeatedSubstringPadding(matchText: string): boolean {
    if (matchText.length < PADDING_SUBSTRING_LENGTH * PADDING_MAX_REPEATS) {
        return false;
    }
    const seen = new Map<string, { count: number; lastEnd: number }>();
    for (let i = 0; i <= matchText.length - PADDING_SUBSTRING_LENGTH; i += 1) {
        const slice = matchText.slice(i, i + PADDING_SUBSTRING_LENGTH);
        const existing = seen.get(slice);
        if (!existing) {
            seen.set(slice, { count: 1, lastEnd: i + PADDING_SUBSTRING_LENGTH });
            continue;
        }
        if (i >= existing.lastEnd) {
            existing.count += 1;
            existing.lastEnd = i + PADDING_SUBSTRING_LENGTH;
            if (existing.count >= PADDING_MAX_REPEATS) {
                return true;
            }
        }
    }
    return false;
}

function isFillerWord(word: string): boolean {
    if (FILLER_WORDS.has(word)) {
        return true;
    }
    return FILLER_WORDS_LIST.some((target) => isFuzzyWordMatch(word, target));
}

export const qualityRule: AnalyzerRule = {
    id: 'quality',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        const {
            sanitizedPrompt,
            matchText,
            matchWords,
            fuzzyWords,
            mode,
            config,
            detectedLanguage,
        } = ctx;

        // 1. Custom blocked terms (accent-insensitive + optional fuzzy matching)
        if (config.blockedTerms.length > 0) {
            const matchedTerms: string[] = [];
            for (const rawTerm of config.blockedTerms) {
                const term = toMatchableText(rawTerm.trim());
                if (!term) continue;
                const termRe = new RegExp(`(?<!\\p{L})${escapeRegex(term)}(?!\\p{L})`, 'u');
                if (termRe.test(matchText)) {
                    matchedTerms.push(rawTerm);
                    continue;
                }
                if (config.fuzzyBlockedTerms && !/\s/.test(term)) {
                    const fuzzyTerm = toFuzzyMatchableText(term);
                    if (fuzzyWords.some((word) => isFuzzyWordMatch(word, fuzzyTerm))) {
                        matchedTerms.push(rawTerm);
                    }
                }
            }
            if (matchedTerms.length > 0) {
                findings.push({
                    code: 'BLOCKED_TERM_DETECTED',
                    ruleId: 'quality',
                    severity: 'block',
                    message: getFindingMessage('BLOCKED_TERM_DETECTED', detectedLanguage),
                    metadata: { terms: matchedTerms },
                });
            }
        }

        // 2. Unrendered template placeholders (prose mode only)
        if (mode === 'prose' && hasUnrenderedPlaceholder(sanitizedPrompt)) {
            findings.push({
                code: 'UNRENDERED_PLACEHOLDER',
                ruleId: 'quality',
                severity: 'warn',
                message: getFindingMessage('UNRENDERED_PLACEHOLDER', detectedLanguage),
            });
        }

        // 3. Pure greeting / filler without an actionable request (misspelling-aware)
        let isPureFiller = false;
        if (mode === 'prose' && fuzzyWords.length > 0 && fuzzyWords.length <= 5) {
            const hasMeaningfulWord = fuzzyWords.some((word) => !isFillerWord(word));
            if (!hasMeaningfulWord) {
                isPureFiller = true;
                findings.push({
                    code: 'LOW_INTENT_FILLER',
                    ruleId: 'quality',
                    severity: 'warn',
                    message: getFindingMessage('LOW_INTENT_FILLER', detectedLanguage),
                });
            }
        }

        // 3b. Vague / directionless short-to-medium prose (only generic verbs/pronouns, no concrete topic)
        if (
            mode === 'prose' &&
            !isPureFiller &&
            matchWords.length >= 2 &&
            matchWords.length <= MAX_WORDS_FOR_VAGUENESS &&
            !/[\d`"]/.test(sanitizedPrompt)
        ) {
            const hasConcreteTopic = matchWords.some(
                (word) => !FILLER_WORDS.has(word) && !VAGUE_STOP_AND_DEICTIC_WORDS.has(word),
            );
            if (!hasConcreteTopic) {
                findings.push({
                    code: 'VAGUE_PROMPT',
                    ruleId: 'quality',
                    severity: 'warn',
                    message: getFindingMessage('VAGUE_PROMPT', detectedLanguage),
                });
            }
        }

        // 4. Lexical diversity & copy-paste padding in longer prose prompts
        if (mode === 'prose' && matchWords.length >= MIN_WORDS_FOR_PROSE_DIVERSITY) {
            const distinctWords = new Set(matchWords).size;
            const uniqueRatio = distinctWords / matchWords.length;
            if (
                uniqueRatio < MIN_PROSE_UNIQUE_WORD_RATIO ||
                distinctWords < MIN_PROSE_DISTINCT_WORDS
            ) {
                findings.push({
                    code: 'LOW_PROSE_DIVERSITY',
                    ruleId: 'quality',
                    severity: 'warn',
                    message: getFindingMessage('LOW_PROSE_DIVERSITY', detectedLanguage),
                    metadata: {
                        distinctWords,
                        uniqueRatio: Number(uniqueRatio.toFixed(3)),
                    },
                });
            } else if (hasRepeatedSubstringPadding(matchText)) {
                findings.push({
                    code: 'REPEATED_PHRASE_PADDING',
                    ruleId: 'quality',
                    severity: 'warn',
                    message: getFindingMessage('REPEATED_PHRASE_PADDING', detectedLanguage),
                });
            }
        }

        return { findings };
    },
};
