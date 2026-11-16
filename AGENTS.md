# AGENTS.md

This file provides guidance to AI coding agents and human contributors working in the `prompt-analizer` repository.

## Project Overview

`prompt-analizer` is a **TypeScript / Node.js npm package** that validates and analyzes user inputs **before** they are sent to an LLM.

### Core Design Constraints (Non-Negotiable)

1. **Zero External AI / LLM Calls**: Every check must run 100% locally, offline, and deterministically. Never add SDKs or HTTP calls to OpenAI, Anthropic, Google, Hugging Face, or any external inference API.
2. **Spanish-First, Bilingual-Ready**: The primary target language is **Spanish**, while gracefully handling technical Spanglish and English inputs (especially for prompt-injection and secret detection).
3. **Low Latency**: The full analysis pipeline should execute in a few milliseconds (`< 5 ms` for typical prompts).
4. **Package Manager**: Always use **`pnpm`** (`pnpm install`, `pnpm add`, `pnpm test`, `pnpm build`, `pnpm typecheck`). Do not generate `package-lock.json` or `yarn.lock`.

---

## Architecture

The library follows a **composable, layered rule pipeline**:

```text
rawInput (string)
  │
  ▼
1. Normalization (src/normalize.ts)
  • Strips/flags dangerous invisible, null, control, and bidi override chars
  • Normalizes Unicode to NFC (preserving á, é, í, ó, ú, ü, ñ, ¿, ¡)
  • Builds a lowercase, diacritic-stripped shadow copy (`matchText`) for matching
  • Extracts Unicode-aware words (`\p{L}`)
  │
  ▼
2. Local Tokenization (src/tokenizer.ts)
  • Counts BPE tokens offline via `js-tiktoken` (no network calls)
  │
  ▼
3. Rule Pipeline (src/rules/*.ts)
  • length.ts        – empty, min/max characters and words
  • token-budget.ts  – local token count vs. maxTokens
  • gibberish.ts     – repetition, zlib compression ratio, symbol ratio, Spanish vowel/consonant heuristics
  • secrets-pii.ts   – API keys, private keys, JWTs, credit cards (Luhn), emails, phones, regional IDs (redact or block)
  • injection.ts     – weighted risk score for ES + EN prompt-injection & delimiter-spoofing patterns
  • quality.ts       – ES + EN filler/greeting detection, meaningful-word ratio, unrendered template placeholders
  │
  ▼
4. Verdict Aggregation (src/analyzer.ts)
  • Produces AnalysisResult: { valid, action, riskScore, sanitizedPrompt, findings, metrics }
```

### Action & Severity Semantics

- `info`: Informational finding; does not invalidate the prompt.
- `warn`: Soft issue (e.g., short/vague prompt, borderline injection score); `valid` remains `true`, `action` becomes `'warn'` unless a higher-severity action applies.
- `redact`: Sensitive data (e.g., email, phone, card) was replaced in `sanitizedPrompt`; `valid` remains `true` if `piiAction === 'redact'`.
- `block`: Hard failure (empty input, over token limit, leaked secret, high-confidence injection, gibberish); `valid` is `false` and `action` is `'block'`.

---

## Spanish-Language Engineering Rules

When writing or modifying rules, always follow these practices:

1. **Never use `[a-zA-Z]` alone** for letter or word matching. Always use Unicode property escapes (`\p{L}`, `\p{N}`, `\p{M}`) with the `/u` flag so `ñ`, `á`, `é`, `í`, `ó`, `ú`, `ü`, `¿`, and `¡` work correctly.
2. **Preserve accents in `sanitizedPrompt`, strip them in `matchText`**:
   - Users often omit tildes (`"como hacer"` vs `"cómo hacer"`, `"ignora"` vs `"ignóra"`).
   - Match keywords and injection phrases against `ctx.matchText` (NFD-decomposed, `\p{M}` removed, lowercased).
   - Never mutate accents in `ctx.sanitizedPrompt`.
3. **Never estimate Spanish tokens by word count**: Spanish uses ~20–40% more BPE tokens per word than English due to verb conjugations, articles, and accents. Always use `ctx.tokenCount` from `src/tokenizer.ts`.
4. **Respect `mode: 'code' | 'prose' | 'auto'`**: Technical Spanish prompts often embed code snippets, JSON, or English terms (`deploy`, `API`, `endpoint`). Do not penalize high symbol ratios or English technical vocabulary when code is detected or `mode === 'code'`.

---

## Coding & Contribution Guidelines

- **TypeScript Strictness**: `strict: true` and `noUncheckedIndexedAccess: true` are enabled in `tsconfig.json`. Handle `undefined` array/match accesses explicitly.
- **Pure, Stateless Rules**: Each rule in `src/rules/` must implement `AnalyzerRule`:
  ```ts
  export interface AnalyzerRule {
    id: string;
    run(ctx: PromptContext): RuleOutput | void;
  }
  ```
  Rules should not mutate shared global state or perform I/O.
- **Keep Rules Focused & Small**: One concern per file in `src/rules/`. Share common helpers (e.g., Shannon entropy, Luhn check) rather than duplicating logic.
- **ReDoS Safety**: Avoid nested quantifiers in regexes (e.g., `(a+)+`). All regexes run on untrusted user input and must execute in linear time.
- **Public API**: Export all public types, rule factories, `PromptAnalyzer`, `createPromptAnalyzer`, and `analyzePrompt` from `src/index.ts`.

---

## Testing & Verification

Every new rule, bug fix, or threshold change must include unit tests in `tests/` covering:

1. Valid Spanish prompts (with and without accents, plus technical Spanglish).
2. Edge cases (empty strings, invisible/bidi characters, code blocks).
3. Positive detections (gibberish, PII/secrets, ES & EN prompt injections, token limits).
4. False-positive checks (normal Spanish prose that happens to contain words like `"sistema"` or `"instrucciones"` in a benign context).

### Commands

```bash
pnpm install      # Install dependencies
pnpm typecheck    # Run TypeScript type checking (tsc --noEmit)
pnpm test         # Run Vitest unit & integration tests
pnpm run lint     # Run ESLint
pnpm run format   # Format code with Prettier
pnpm build        # Build ESM + CJS + .d.ts bundles into dist/
```
