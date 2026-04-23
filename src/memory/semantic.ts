import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SemanticMemoryEntry, SemanticCategory } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.semantic");
type Database = BetterSqlite3.Database;

export class SemanticMemoryManager {
  constructor(private readonly db: Database) {}

  store(entry: {
    category: SemanticCategory;
    key: string;
    value: string;
    confidence?: number;
    source: string;
    embeddingKey?: string | null;
  }): string {
    const id = randomUUID();
    try {
      this.db.prepare(
        `INSERT INTO semantic_memory (id, category, key, value, confidence, source, embedding_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(category, key) DO UPDATE SET
           value = excluded.value,
           confidence = excluded.confidence,
           source = excluded.source,
           embedding_key = excluded.embedding_key,
           updated_at = datetime('now')`,
      ).run(
        id,
        entry.category,
        entry.key,
        entry.value,
        entry.confidence ?? 1.0,
        entry.source,
        entry.embeddingKey ?? null,
      );

      const row = this.db.prepare(
        "SELECT id FROM semantic_memory WHERE category = ? AND key = ?",
      ).get(entry.category, entry.key) as { id: string } | undefined;
      if (row) return row.id;
    } catch (error) {
      logger.error("Failed to store semantic memory", error instanceof Error ? error : undefined);
    }
    return id;
  }

  get(category: SemanticCategory, key: string): SemanticMemoryEntry | undefined {
    try {
      const row = this.db.prepare(
        "SELECT * FROM semantic_memory WHERE category = ? AND key = ?",
      ).get(category, key) as any | undefined;
      return row ? deserializeSemantic(row) : undefined;
    } catch (error) {
      logger.error("Failed to get semantic memory", error instanceof Error ? error : undefined);
      return undefined;
    }
  }

  search(query: string, category?: SemanticCategory): SemanticMemoryEntry[] {
    try {
      const escaped = query.replace(/[%_]/g, (char) => `\\${char}`);
      if (category) {
        const rows = this.db.prepare(
          `SELECT * FROM semantic_memory
           WHERE category = ? AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')
           ORDER BY confidence DESC, updated_at DESC`,
        ).all(category, `%${escaped}%`, `%${escaped}%`) as any[];
        return rows.map(deserializeSemantic);
      }
      const rows = this.db.prepare(
        `SELECT * FROM semantic_memory
         WHERE key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\'
         ORDER BY confidence DESC, updated_at DESC`,
      ).all(`%${escaped}%`, `%${escaped}%`) as any[];
      return rows.map(deserializeSemantic);
    } catch (error) {
      logger.error("Failed to search semantic memory", error instanceof Error ? error : undefined);
      return [];
    }
  }

  getByCategory(category: SemanticCategory): SemanticMemoryEntry[] {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM semantic_memory WHERE category = ? ORDER BY confidence DESC, updated_at DESC",
      ).all(category) as any[];
      return rows.map(deserializeSemantic);
    } catch (error) {
      logger.error("Failed to get semantic memory by category", error instanceof Error ? error : undefined);
      return [];
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM semantic_memory WHERE id = ?").run(id);
    } catch (error) {
      logger.error("Failed to delete semantic memory", error instanceof Error ? error : undefined);
    }
  }

  prune(maxEntries: number = 500): number {
    try {
      const count = this.db.prepare("SELECT COUNT(*) as cnt FROM semantic_memory").get() as { cnt: number };
      if (count.cnt <= maxEntries) return 0;
      const result = this.db.prepare(
        `DELETE FROM semantic_memory WHERE id IN (
          SELECT id FROM semantic_memory ORDER BY confidence ASC, updated_at ASC LIMIT ?
        )`,
      ).run(count.cnt - maxEntries);
      return result.changes;
    } catch (error) {
      logger.error("Failed to prune semantic memory", error instanceof Error ? error : undefined);
      return 0;
    }
  }
}

function deserializeSemantic(row: any): SemanticMemoryEntry {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    value: row.value,
    confidence: row.confidence,
    source: row.source,
    embeddingKey: row.embedding_key ?? null,
    lastVerifiedAt: row.last_verified_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
