import { WorkingMemoryManager } from "./working.js";
import { EpisodicMemoryManager } from "./episodic.js";
import { SemanticMemoryManager } from "./semantic.js";
import { ProceduralMemoryManager } from "./procedural.js";
import { RelationshipMemoryManager } from "./relationship.js";
import type { SemanticCategory, ProceduralStep } from "../types.js";

export function createMemoryTools(db: import("better-sqlite3").Database) {
  const working = new WorkingMemoryManager(db);
  const episodic = new EpisodicMemoryManager(db);
  const semantic = new SemanticMemoryManager(db);
  const procedural = new ProceduralMemoryManager(db);
  const relationships = new RelationshipMemoryManager(db);

  return {
    rememberFact(category: SemanticCategory, key: string, value: string, source: string): string {
      return semantic.store({ category, key, value, source, confidence: 0.8 });
    },
    recallFacts(query: string) {
      return semantic.search(query);
    },
    saveProcedure(name: string, description: string, steps: ProceduralStep[]): string {
      return procedural.save({ name, description, steps });
    },
    recallProcedure(query: string) {
      return procedural.search(query);
    },
    noteRelationship(entityAddress: string, relationshipType: string, entityName?: string | null): string {
      return relationships.record({ entityAddress, entityName, relationshipType, trustScore: 0.5 });
    },
    getWorkingMemory(sessionId: string) {
      return working.getBySession(sessionId);
    },
    getRecentEpisodes(sessionId: string) {
      return episodic.getRecent(sessionId);
    },
  };
}
