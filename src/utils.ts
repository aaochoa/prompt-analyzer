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
