import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { RelationshipMemoryEntry } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.relationship");
type Database = BetterSqlite3.Database;

export class RelationshipMemoryManager {
  constructor(private readonly db: Database) {}

  record(entry: {
    entityAddress: string;
    entityName?: string | null;
    relationshipType: string;
    trustScore?: number;
    notes?: string | null;
  }): string {
    const id = randomUUID();
    try {
      this.db.prepare(
        `INSERT INTO relationship_memory (id, entity_address, entity_name, relationship_type, trust_score, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_address) DO UPDATE SET
           entity_name = COALESCE(excluded.entity_name, relationship_memory.entity_name),
           relationship_type = excluded.relationship_type,
           trust_score = excluded.trust_score,
           notes = COALESCE(excluded.notes, relationship_memory.notes),
           updated_at = datetime('now')`,
      ).run(
        id,
        entry.entityAddress,
        entry.entityName ?? null,
        entry.relationshipType,
        entry.trustScore ?? 0.5,
        entry.notes ?? null,
      );
    } catch (error) {
      logger.error("Failed to record relationship memory", error instanceof Error ? error : undefined);
    }
    return id;
  }

  get(entityAddress: string): RelationshipMemoryEntry | undefined {
    try {
      const row = this.db.prepare(
        "SELECT * FROM relationship_memory WHERE entity_address = ?",
      ).get(entityAddress) as any | undefined;
      return row ? deserializeRelationship(row) : undefined;
    } catch (error) {
      logger.error("Failed to get relationship memory", error instanceof Error ? error : undefined);
      return undefined;
    }
  }

  recordInteraction(entityAddress: string): void {
    try {
      this.db.prepare(
        `UPDATE relationship_memory
         SET interaction_count = interaction_count + 1,
             last_interaction_at = datetime('now'),
             updated_at = datetime('now')
         WHERE entity_address = ?`,
      ).run(entityAddress);
    } catch (error) {
      logger.error("Failed to record interaction", error instanceof Error ? error : undefined);
    }
  }

  updateTrust(entityAddress: string, delta: number): void {
    try {
      this.db.prepare(
        `UPDATE relationship_memory
         SET trust_score = MAX(0.0, MIN(1.0, trust_score + ?)),
             updated_at = datetime('now')
         WHERE entity_address = ?`,
      ).run(delta, entityAddress);
    } catch (error) {
      logger.error("Failed to update trust", error instanceof Error ? error : undefined);
    }
  }

  getTrusted(minTrust: number = 0.5): RelationshipMemoryEntry[] {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM relationship_memory WHERE trust_score >= ? ORDER BY trust_score DESC, interaction_count DESC",
      ).all(minTrust) as any[];
      return rows.map(deserializeRelationship);
    } catch (error) {
      logger.error("Failed to get trusted relationships", error instanceof Error ? error : undefined);
      return [];
    }
  }

  delete(entityAddress: string): void {
    try {
      this.db.prepare("DELETE FROM relationship_memory WHERE entity_address = ?").run(entityAddress);
    } catch (error) {
      logger.error("Failed to delete relationship memory", error instanceof Error ? error : undefined);
    }
  }
}

function deserializeRelationship(row: any): RelationshipMemoryEntry {
  return {
    id: row.id,
    entityAddress: row.entity_address,
    entityName: row.entity_name ?? null,
    relationshipType: row.relationship_type,
    trustScore: row.trust_score,
    interactionCount: row.interaction_count,
    lastInteractionAt: row.last_interaction_at ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
