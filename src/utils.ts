/**
 * Computes Shannon entropy (bits per character) for a string.
 */
export function shannonEntropy(input: string): number {
    if (input.length === 0) {
        return 0;
    }

    const freq = new Map<string, number>();
    for (const ch of input) {
        freq.set(ch, (freq.get(ch) ?? 0) + 1);
    }

    let entropy = 0;
    const len = input.length;
    for (const count of freq.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }

    return entropy;
}

/**
 * Validates a numeric sequence using the Luhn checksum algorithm (e.g. credit cards).
 */
export function passesLuhnCheck(digitsOnly: string): boolean {
    if (!/^\d{13,19}$/.test(digitsOnly)) {
        return false;
    }

    let sum = 0;
    let shouldDouble = false;

    for (let i = digitsOnly.length - 1; i >= 0; i -= 1) {
        const ch = digitsOnly[i];
        if (ch === undefined) {
            continue;
        }
        let digit = Number.parseInt(ch, 10);
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
}

/**
 * Computes the Optimal String Alignment (restricted Damerau-Levenshtein) distance
 * between two strings, returning `maxDist + 1` early when the bound is exceeded.
 */
export function damerauLevenshtein(a: string, b: string, maxDist = 2): number {
    if (a === b) {
        return 0;
    }

    const lenA = a.length;
    const lenB = b.length;
    if (Math.abs(lenA - lenB) > maxDist) {
        return maxDist + 1;
    }
    if (lenA === 0) {
        return lenB;
    }
    if (lenB === 0) {
        return lenA;
    }

    const cols = lenB + 1;
    const dp = new Int32Array((lenA + 1) * cols);

    for (let i = 0; i <= lenA; i += 1) {
        dp[i * cols] = i;
    }
    for (let j = 0; j <= lenB; j += 1) {
        dp[j] = j;
    }

    for (let i = 1; i <= lenA; i += 1) {
        let rowMin = maxDist + 1;
        const chA = a[i - 1];
        for (let j = 1; j <= lenB; j += 1) {
            const chB = b[j - 1];
            const cost = chA === chB ? 0 : 1;

            const del = (dp[(i - 1) * cols + j] ?? maxDist + 1) + 1;
            const ins = (dp[i * cols + (j - 1)] ?? maxDist + 1) + 1;
            const sub = (dp[(i - 1) * cols + (j - 1)] ?? maxDist + 1) + cost;
            let best = Math.min(del, ins, sub);

            if (i > 1 && j > 1 && chA === b[j - 2] && a[i - 2] === chB) {
                const trans = (dp[(i - 2) * cols + (j - 2)] ?? maxDist + 1) + cost;
                if (trans < best) {
                    best = trans;
                }
            }

            dp[i * cols + j] = best;
            if (best < rowMin) {
                rowMin = best;
            }
        }
        if (rowMin > maxDist) {
            return maxDist + 1;
        }
    }

    return dp[lenA * cols + lenB] ?? maxDist + 1;
}

/**
 * Length-gated fuzzy word matcher for misspelling resilience.
 * Short words (< 4 chars) require exact equality to avoid false positives.
 */
export function isFuzzyWordMatch(word: string, target: string): boolean {
    if (word === target) {
        return true;
    }
    if (target.length < 4 || word.length < 3) {
        return false;
    }

    const maxDist = target.length >= 7 ? 2 : 1;
    if (Math.abs(word.length - target.length) > maxDist) {
        return false;
    }

    return damerauLevenshtein(word, target, maxDist) <= maxDist;
}
