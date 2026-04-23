import type { MemoryBudget } from "../types.js";
import type { ContextManager } from "./context-manager.js";
import { MemoryRetriever } from "./retrieval.js";

export class EnhancedMemoryRetriever {
  private readonly retriever: MemoryRetriever;

  constructor(
    db: import("better-sqlite3").Database,
    private readonly contextManager: ContextManager,
    budget: MemoryBudget,
  ) {
    this.retriever = new MemoryRetriever(db, budget);
  }

  retrieve(sessionId: string, currentInput?: string) {
    return this.retriever.retrieve(sessionId, currentInput);
  }
}
