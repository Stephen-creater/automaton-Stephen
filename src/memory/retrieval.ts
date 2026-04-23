import type BetterSqlite3 from "better-sqlite3";
import type { MemoryBudget, MemoryRetrievalResult } from "../types.js";
import { DEFAULT_MEMORY_BUDGET } from "../types.js";
import { WorkingMemoryManager } from "./working.js";
import { EpisodicMemoryManager } from "./episodic.js";
import { SemanticMemoryManager } from "./semantic.js";
import { ProceduralMemoryManager } from "./procedural.js";
import { RelationshipMemoryManager } from "./relationship.js";
import { MemoryBudgetManager } from "./budget.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.retrieval");
type Database = BetterSqlite3.Database;

export class MemoryRetriever {
  private readonly working: WorkingMemoryManager;
  private readonly episodic: EpisodicMemoryManager;
  private readonly semantic: SemanticMemoryManager;
  private readonly procedural: ProceduralMemoryManager;
  private readonly relationships: RelationshipMemoryManager;
  private readonly budgetManager: MemoryBudgetManager;

  constructor(db: Database, budget?: MemoryBudget) {
    this.working = new WorkingMemoryManager(db);
    this.episodic = new EpisodicMemoryManager(db);
    this.semantic = new SemanticMemoryManager(db);
    this.procedural = new ProceduralMemoryManager(db);
    this.relationships = new RelationshipMemoryManager(db);
    this.budgetManager = new MemoryBudgetManager(budget ?? DEFAULT_MEMORY_BUDGET);
  }

  retrieve(sessionId: string, currentInput?: string): MemoryRetrievalResult {
    try {
      const raw: MemoryRetrievalResult = {
        workingMemory: this.working.getBySession(sessionId),
        episodicMemory: this.episodic.getRecent(sessionId, 20),
        semanticMemory: currentInput ? this.semantic.search(currentInput) : this.semantic.getByCategory("self"),
        proceduralMemory: currentInput ? this.procedural.search(currentInput) : [],
        relationships: this.relationships.getTrusted(0.3),
        totalTokens: 0,
      };
      return this.budgetManager.allocate(raw);
    } catch (error) {
      logger.error("Retrieval failed", error instanceof Error ? error : undefined);
      return {
        workingMemory: [],
        episodicMemory: [],
        semanticMemory: [],
        proceduralMemory: [],
        relationships: [],
        totalTokens: 0,
      };
    }
  }
}
