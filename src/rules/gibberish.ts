import { deflateSync } from 'node:zlib';
import type { AnalyzerRule, Finding, PromptContext } from '../types.js';

const REPEATED_CHAR_RE = /(.)\1{9,}/u;
const CONSONANT_CLUSTER_RE = /[bcdfghjklmnpqrstvwxyz]{5,}/;
const ALLOWED_PROSE_PUNCT_RE = /[\p{L}\p{N}\s.,;:¿?¡!()'"\-/%+]/gu;

export const gibberishRule: AnalyzerRule = {
  id: 'gibberish',
  run(ctx: PromptContext) {
    const findings: Finding[] = [];
    const { sanitizedPrompt, matchWords, mode } = ctx;

    if (sanitizedPrompt.length === 0) {
      return { findings };
    }

    // 1. Long single-character repetition (e.g., "aaaaaaaaaa")
    if (REPEATED_CHAR_RE.test(sanitizedPrompt)) {
      findings.push({
        code: 'REPEATED_CHARACTERS',
        ruleId: 'gibberish',
        severity: 'block',
        message: 'El prompt contiene repeticiones excesivas de un mismo carácter.',
      });
      return { findings };
    }

    // 2. Word-level spam / compression-based repetition check
    if (sanitizedPrompt.length >= 60) {
      const compressedSize = deflateSync(Buffer.from(sanitizedPrompt, 'utf8')).length;
      const compressionRatio = compressedSize / sanitizedPrompt.length;
      if (compressionRatio < 0.22) {
        findings.push({
          code: 'REPETITIVE_SPAM',
          ruleId: 'gibberish',
          severity: 'block',
          message: 'El prompt contiene texto altamente repetitivo o spam.',
          metadata: { compressionRatio: Number(compressionRatio.toFixed(3)) },
        });
        return { findings };
      }
    }

    if (matchWords.length >= 12) {
      const uniqueRatio = new Set(matchWords).size / matchWords.length;
      if (uniqueRatio < 0.22) {
        findings.push({
          code: 'LOW_LEXICAL_DIVERSITY',
          ruleId: 'gibberish',
          severity: 'block',
          message: 'El prompt repite las mismas palabras de forma excesiva.',
          metadata: { uniqueRatio: Number(uniqueRatio.toFixed(3)) },
        });
        return { findings };
      }
    }

    // Skip linguistic / symbol heuristics in code mode
    if (mode === 'code') {
      return { findings };
    }

    // 3. Excessive unexpected symbols in prose
    if (sanitizedPrompt.length >= 15) {
      const allowedChars = sanitizedPrompt.match(ALLOWED_PROSE_PUNCT_RE)?.length ?? 0;
      const unexpectedRatio = 1 - allowedChars / sanitizedPrompt.length;
      if (unexpectedRatio > 0.45) {
        findings.push({
          code: 'EXCESSIVE_SYMBOLS',
          ruleId: 'gibberish',
          severity: 'block',
          message: 'El prompt contiene demasiados símbolos no textuales.',
          metadata: { unexpectedRatio: Number(unexpectedRatio.toFixed(3)) },
        });
        return { findings };
      }
    }

    // 4. Spanish-tuned vowel & consonant-cluster sanity checks
    const joinedLetters = matchWords.join('');
    if (matchWords.length >= 2 && joinedLetters.length >= 12) {
      const vowelCount = (joinedLetters.match(/[aeiou]/g) ?? []).length;
      const vowelRatio = vowelCount / joinedLetters.length;

      if (vowelRatio < 0.16) {
        findings.push({
          code: 'GIBBERISH_LOW_VOWELS',
          ruleId: 'gibberish',
          severity: 'block',
          message: 'El texto no parece lenguaje natural (proporción de vocales demasiado baja).',
          metadata: { vowelRatio: Number(vowelRatio.toFixed(3)) },
        });
        return { findings };
      }

      const longWords = matchWords.filter((w) => w.length >= 6);
      if (longWords.length >= 2) {
        const mashCount = longWords.filter((w) => CONSONANT_CLUSTER_RE.test(w)).length;
        if (mashCount / longWords.length >= 0.5) {
          findings.push({
            code: 'GIBBERISH_KEYBOARD_MASH',
            ruleId: 'gibberish',
            severity: 'block',
            message: 'El texto contiene secuencias de consonantes improbables (posible texto aleatorio).',
          });
        }
      }
    }

    return { findings };
  },
};
