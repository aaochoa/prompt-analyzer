import { getFindingMessage, resolveUiLanguage } from '../i18n.js';
import type { AnalyzerRule, Finding, PromptContext, Severity } from '../types.js';
import {
    isValidChileanRut,
    isValidSpanishDniNie,
    passesLuhnCheck,
    shannonEntropy,
} from '../utils.js';

interface SecretPattern {
    code: string;
    label: string;
    regex: RegExp;
    minEntropy?: number;
}

const SECRET_PATTERNS: SecretPattern[] = [
    {
        code: 'PRIVATE_KEY_DETECTED',
        label: 'clave privada',
        regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    },
    {
        code: 'PRIVATE_KEY_HEADER_DETECTED',
        label: 'cabecera de clave privada',
        regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g,
    },
    {
        code: 'API_KEY_DETECTED',
        label: 'clave de API',
        regex: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{24,}|whsec_[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|gh[pors]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}|SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g,
        minEntropy: 3.0,
    },
    {
        code: 'AUTH_BEARER_DETECTED',
        label: 'token Bearer',
        regex: /\bBearer\s+[A-Za-z0-9._-]{24,}\b/g,
        minEntropy: 3.3,
    },
    {
        code: 'DB_CONNECTION_URI_DETECTED',
        label: 'URI de base de datos con credenciales',
        regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:[^@\s/]+@[^\s)\]}"'>]+(?<![.,;!?])/g,
        minEntropy: 3.0,
    },
    {
        code: 'JWT_DETECTED',
        label: 'token JWT',
        regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        minEntropy: 3.2,
    },
];

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CARD_CANDIDATE_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[\s.-])(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}(?!\d)/g;

// Regional IDs (opt-in via enableRegionalIds)
const SPAIN_DNI_NIE_RE = /\b(?:[XYZ]\d{7}|\d{8})[A-HJ-NP-TV-Z]\b/g;
const MEXICO_CURP_RE = /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[0-9A-Z]\d\b/g;
const CHILE_RUT_RE = /\b\d{1,2}\.\d{3}\.\d{3}-[\dkK]\b/g;
const US_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

function actionToSeverity(action: 'block' | 'redact' | 'warn'): Severity {
    return action;
}

export const secretsPiiRule: AnalyzerRule = {
    id: 'secrets-pii',
    run(ctx: PromptContext) {
        const findings: Finding[] = [];
        let sanitized = ctx.sanitizedPrompt;
        const { secretsAction, piiAction, enableRegionalIds } = ctx.config;
        const { detectedLanguage } = ctx;
        const uiLang = resolveUiLanguage(detectedLanguage);

        // 1. Secrets detection
        let fullPrivateKeyCount = 0;
        for (const pattern of SECRET_PATTERNS) {
            let matchCount = 0;
            sanitized = sanitized.replace(pattern.regex, (matched) => {
                if (
                    pattern.minEntropy !== undefined &&
                    shannonEntropy(matched) < pattern.minEntropy
                ) {
                    return matched;
                }
                matchCount += 1;
                return secretsAction === 'redact' ? `[REDACTED_${pattern.code}]` : matched;
            });

            if (pattern.code === 'PRIVATE_KEY_DETECTED') {
                fullPrivateKeyCount = matchCount;
            } else if (pattern.code === 'PRIVATE_KEY_HEADER_DETECTED' && fullPrivateKeyCount > 0) {
                // Avoid double-reporting headers that belong to an already-detected full PEM block
                matchCount = Math.max(0, matchCount - fullPrivateKeyCount);
            }

            if (matchCount > 0) {
                findings.push({
                    code: pattern.code,
                    ruleId: 'secrets-pii',
                    severity: actionToSeverity(secretsAction),
                    message:
                        uiLang === 'en'
                            ? `Detected ${pattern.label} in the prompt (${matchCount}).`
                            : `Se detectó ${pattern.label} en el prompt (${matchCount}).`,
                    metadata: { count: matchCount },
                });
            }
        }

        // 2. PII detection: Emails
        let emailCount = 0;
        sanitized = sanitized.replace(EMAIL_RE, (matched) => {
            emailCount += 1;
            return piiAction === 'redact' ? '[REDACTED_EMAIL]' : matched;
        });
        if (emailCount > 0) {
            findings.push({
                code: 'PII_EMAIL_DETECTED',
                ruleId: 'secrets-pii',
                severity: actionToSeverity(piiAction),
                message: getFindingMessage('PII_EMAIL_DETECTED', detectedLanguage, {
                    count: emailCount,
                }),
                metadata: { count: emailCount },
            });
        }

        // 3. PII detection: Credit cards (with Luhn validation)
        let cardCount = 0;
        sanitized = sanitized.replace(CARD_CANDIDATE_RE, (matched) => {
            const digits = matched.replace(/\D/g, '');
            if (!passesLuhnCheck(digits)) {
                return matched;
            }
            cardCount += 1;
            return piiAction === 'redact' ? '[REDACTED_CARD]' : matched;
        });
        if (cardCount > 0) {
            findings.push({
                code: 'PII_CREDIT_CARD_DETECTED',
                ruleId: 'secrets-pii',
                severity: actionToSeverity(piiAction),
                message: getFindingMessage('PII_CREDIT_CARD_DETECTED', detectedLanguage, {
                    count: cardCount,
                }),
                metadata: { count: cardCount },
            });
        }

        // 4. PII detection: International phone numbers (+XX ...)
        let phoneCount = 0;
        sanitized = sanitized.replace(PHONE_RE, (matched) => {
            const digits = matched.replace(/\D/g, '');
            if (digits.length < 9 || digits.length > 15) {
                return matched;
            }
            phoneCount += 1;
            return piiAction === 'redact' ? '[REDACTED_PHONE]' : matched;
        });
        if (phoneCount > 0) {
            findings.push({
                code: 'PII_PHONE_DETECTED',
                ruleId: 'secrets-pii',
                severity: actionToSeverity(piiAction),
                message: getFindingMessage('PII_PHONE_DETECTED', detectedLanguage, {
                    count: phoneCount,
                }),
                metadata: { count: phoneCount },
            });
        }

        // 5. Optional regional IDs (Spain DNI/NIE, Mexico CURP, Chile RUT, US SSN)
        if (enableRegionalIds) {
            let idCount = 0;
            sanitized = sanitized.replace(SPAIN_DNI_NIE_RE, (matched) => {
                if (!isValidSpanishDniNie(matched)) {
                    return matched;
                }
                idCount += 1;
                return piiAction === 'redact' ? '[REDACTED_DNI]' : matched;
            });
            sanitized = sanitized.replace(MEXICO_CURP_RE, (matched) => {
                idCount += 1;
                return piiAction === 'redact' ? '[REDACTED_CURP]' : matched;
            });
            sanitized = sanitized.replace(CHILE_RUT_RE, (matched) => {
                if (!isValidChileanRut(matched)) {
                    return matched;
                }
                idCount += 1;
                return piiAction === 'redact' ? '[REDACTED_RUT]' : matched;
            });
            sanitized = sanitized.replace(US_SSN_RE, (matched) => {
                idCount += 1;
                return piiAction === 'redact' ? '[REDACTED_SSN]' : matched;
            });
            if (idCount > 0) {
                findings.push({
                    code: 'PII_REGIONAL_ID_DETECTED',
                    ruleId: 'secrets-pii',
                    severity: actionToSeverity(piiAction),
                    message: getFindingMessage('PII_REGIONAL_ID_DETECTED', detectedLanguage, {
                        count: idCount,
                    }),
                    metadata: { count: idCount },
                });
            }
        }

        return {
            findings,
            sanitizedPrompt: sanitized,
        };
    },
};
