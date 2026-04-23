export interface TokenCounter {
  countTokens(text: string, model?: string): number;
  cache: Map<string, number>;
  countBatch(texts: string[]): number[];
}

export class ContextManager {
  readonly tokenCounter: TokenCounter;

  constructor(tokenCounter: TokenCounter) {
    this.tokenCounter = tokenCounter;
  }
}

function enforceLruLimit(cache: Map<string, number>, maxSize: number): void {
  if (cache.size <= maxSize) {
    return;
  }
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

export function createTokenCounter(): TokenCounter {
  const cache = new Map<string, number>();
  const MAX_TOKEN_CACHE_SIZE = 10_000;

  const countTokens = (text: string, model?: string): number => {
    const normalized = text ?? "";
    const key = `${model ?? "default"}::${normalized}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }

    const count = Math.ceil(normalized.length / 3.5);
    cache.set(key, count);
    enforceLruLimit(cache, MAX_TOKEN_CACHE_SIZE);
    return count;
  };

  return {
    countTokens,
    cache,
    countBatch(texts: string[]): number[] {
      return texts.map((text) => countTokens(text));
    },
  };
}
