import type { MemoryBudget, MemoryRetrievalResult } from "../types.js";
import { estimateTokens } from "../agent/context.js";

export class MemoryBudgetManager {
  constructor(private readonly budget: MemoryBudget) {}

  allocate(memories: MemoryRetrievalResult): MemoryRetrievalResult {
    let totalTokens = 0;

    const { items: workingMemory, tokens: workingTokens } = this.trimTier(
      memories.workingMemory,
      this.budget.workingMemoryTokens,
      (entry) => estimateTokens(entry.content),
    );
    totalTokens += workingTokens;

    const { items: episodicMemory, tokens: episodicTokens } = this.trimTier(
      memories.episodicMemory,
      this.budget.episodicMemoryTokens,
      (entry) => estimateTokens(entry.summary + (entry.detail || "")),
    );
    totalTokens += episodicTokens;

    const { items: semanticMemory, tokens: semanticTokens } = this.trimTier(
      memories.semanticMemory,
      this.budget.semanticMemoryTokens,
      (entry) => estimateTokens(`${entry.category}/${entry.key}: ${entry.value}`),
    );
    totalTokens += semanticTokens;

    const { items: proceduralMemory, tokens: proceduralTokens } = this.trimTier(
      memories.proceduralMemory,
      this.budget.proceduralMemoryTokens,
      (entry) => estimateTokens(`${entry.name}: ${entry.description}`),
    );
    totalTokens += proceduralTokens;

    const { items: relationships, tokens: relationshipTokens } = this.trimTier(
      memories.relationships,
      this.budget.relationshipMemoryTokens,
      (entry) => estimateTokens(`${entry.entityAddress}: ${entry.relationshipType}`),
    );
    totalTokens += relationshipTokens;

    return {
      workingMemory,
      episodicMemory,
      semanticMemory,
      proceduralMemory,
      relationships,
      totalTokens,
    };
  }

  getTotalBudget(): number {
    return this.budget.workingMemoryTokens
      + this.budget.episodicMemoryTokens
      + this.budget.semanticMemoryTokens
      + this.budget.proceduralMemoryTokens
      + this.budget.relationshipMemoryTokens;
  }

  private trimTier<T>(
    items: T[],
    budgetTokens: number,
    estimateFn: (item: T) => number,
  ): { items: T[]; tokens: number } {
    const result: T[] = [];
    let tokens = 0;

    for (const item of items) {
      const itemTokens = estimateFn(item);
      if (tokens + itemTokens > budgetTokens) break;
      result.push(item);
      tokens += itemTokens;
    }

    return { items: result, tokens };
  }
}
