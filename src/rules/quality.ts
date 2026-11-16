import { toMatchableText } from '../normalize.js';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

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
  'prueba',
  'probando',
  'si',
  'no',
  'ey',
  'alo',
]);

const MUSTACHE_OR_ANGLE_PLACEHOLDER_RE =
  /(?:\{\{\s*[\p{L}_][\p{L}\p{N}_.-]*\s*\}\}|<(?:INSERT|TU|YOUR)[_ ][\p{L}_ ]+>)/u;
const BRACKET_SEGMENT_RE = /\[([^\[\]\n]{2,120})\]/gu;
const ALLOWED_BRACKET_MARKER_RE = /^(?:FALTA|SUPUESTO|PENDIENTE|REDACTED_[A-Z_]+)\b/iu;
const UPPERCASE_BRACKET_PLACEHOLDER_RE = /^(?:INSERT|TU|YOUR)[_ ][\p{L}_ ]+$/u;
const SPANISH_TEMPLATE_PLACEHOLDER_RE =
  /^(?:pega |tu |que:|quien |en una |en dos |comparte |escribe |inserta |indica |pon |reemplaza |nombre |rol |una linea|paso propio|como quieres)/u;

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
    if (SPANISH_TEMPLATE_PLACEHOLDER_RE.test(toMatchableText(inner))) {
      return true;
    }
  }

  return false;
}

function hasRepeatedSubstringPadding(matchText: string): boolean {
  if (matchText.length < PADDING_SUBSTRING_LENGTH * PADDING_MAX_REPEATS) {
    return false;
  }
  const counts = new Map<string, number>();
  for (let i = 0; i <= matchText.length - PADDING_SUBSTRING_LENGTH; i += 1) {
    const slice = matchText.slice(i, i + PADDING_SUBSTRING_LENGTH);
    const next = (counts.get(slice) ?? 0) + 1;
    if (next >= PADDING_MAX_REPEATS) {
      return true;
    }
    counts.set(slice, next);
  }
  return false;
}

export const qualityRule: AnalyzerRule = {
  id: 'quality',
  run(ctx: PromptContext) {
    const findings: Finding[] = [];
    const { sanitizedPrompt, matchText, matchWords, mode, config } = ctx;

    // 1. Custom blocked terms (accent-insensitive)
    if (config.blockedTerms.length > 0) {
      const matchedTerms: string[] = [];
      for (const rawTerm of config.blockedTerms) {
        const term = toMatchableText(rawTerm.trim());
        if (!term) continue;
        const termRe = new RegExp(`(?<!\\p{L})${escapeRegex(term)}(?!\\p{L})`, 'u');
        if (termRe.test(matchText)) {
          matchedTerms.push(rawTerm);
        }
      }
      if (matchedTerms.length > 0) {
        findings.push({
          code: 'BLOCKED_TERM_DETECTED',
          ruleId: 'quality',
          severity: 'block',
          message: 'El prompt contiene términos bloqueados por la política configurada.',
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
        message: 'El prompt parece contener marcadores de plantilla sin reemplazar.',
      });
    }

    // 3. Pure greeting / filler without an actionable request
    if (mode === 'prose' && matchWords.length > 0 && matchWords.length <= 5) {
      const hasMeaningfulWord = matchWords.some((word) => !FILLER_WORDS.has(word));
      if (!hasMeaningfulWord) {
        findings.push({
          code: 'LOW_INTENT_FILLER',
          ruleId: 'quality',
          severity: 'warn',
          message: 'El prompt solo contiene un saludo o texto de relleno sin una petición clara.',
        });
      }
    }

    // 4. Lexical diversity & copy-paste padding in longer prose prompts
    if (mode === 'prose' && matchWords.length >= MIN_WORDS_FOR_PROSE_DIVERSITY) {
      const distinctWords = new Set(matchWords).size;
      const uniqueRatio = distinctWords / matchWords.length;
      if (uniqueRatio < MIN_PROSE_UNIQUE_WORD_RATIO || distinctWords < MIN_PROSE_DISTINCT_WORDS) {
        findings.push({
          code: 'LOW_PROSE_DIVERSITY',
          ruleId: 'quality',
          severity: 'warn',
          message: 'El prompt tiene poca variedad de palabras para su longitud.',
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
          message: 'El prompt repite fragmentos idénticos varias veces.',
        });
      }
    }

    return { findings };
  },
};
