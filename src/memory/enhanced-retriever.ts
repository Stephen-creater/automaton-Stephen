import type { MemoryBudget } from "../types.js";
import type { ContextManager } from "./context-manager.js";
import { MemoryRetriever } from "./retrieval.js";
import { estimateTokens } from "../agent/context.js";

export class EnhancedMemoryRetriever {
  private readonly retriever: MemoryRetriever;

  constructor(
    db: import("better-sqlite3").Database,
    private readonly contextManager: ContextManager,
    budget: MemoryBudget,
  ) {
    this.retriever = new MemoryRetriever(db, budget);
  }

  retrieve(sessionId: string, currentInput?: string, currentContext?: string) {
    const memories = this.retriever.retrieve(sessionId, currentInput);
    if (!currentContext) return memories;

    const contextTokens = this.contextManager.tokenCounter.countTokens(currentContext);
    if (contextTokens < 2000) return memories;

    return {
      ...memories,
      episodicMemory: memories.episodicMemory.slice(0, 3),
      semanticMemory: memories.semanticMemory.slice(0, 3),
      proceduralMemory: memories.proceduralMemory.slice(0, 2),
      relationships: memories.relationships.slice(0, 2),
      totalTokens: estimateTokens(JSON.stringify(memories).slice(0, 4000)),
    };
  }
}
