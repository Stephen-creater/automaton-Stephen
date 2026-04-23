import type { MemoryRetrievalResult } from "../types.js";
import { MemoryRetriever } from "./retrieval.js";

export class AgentContextAggregator {
  constructor(private readonly retriever: MemoryRetriever) {}

  build(sessionId: string, currentInput?: string): MemoryRetrievalResult {
    return this.retriever.retrieve(sessionId, currentInput);
  }
}
