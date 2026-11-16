import { encodingForModel, type Tiktoken, type TiktokenModel } from 'js-tiktoken';

const encoderCache = new Map<string, Tiktoken>();

function getEncoder(model: TiktokenModel): Tiktoken {
    let encoder = encoderCache.get(model);
    if (!encoder) {
        encoder = encodingForModel(model);
        encoderCache.set(model, encoder);
    }
    return encoder;
}

/**
 * Pre-loads the local tiktoken BPE encoder so the first analyze() call has no cold-start delay.
 */
export function warmupTokenizer(model: TiktokenModel = 'gpt-4o'): void {
    getEncoder(model);
}

/**
 * Counts tokens locally and offline using js-tiktoken (or a custom counter).
 */
export function countTokens(
    text: string,
    model: TiktokenModel = 'gpt-4o',
    customCounter?: (text: string) => number,
): number {
    if (text.length === 0) {
        return 0;
    }
    if (customCounter) {
        return customCounter(text);
    }
    return getEncoder(model).encode(text).length;
}
