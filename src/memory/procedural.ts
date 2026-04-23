import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ProceduralMemoryEntry, ProceduralStep } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.procedural");
type Database = BetterSqlite3.Database;

export class ProceduralMemoryManager {
  constructor(private readonly db: Database) {}

  save(entry: {
    name: string;
    description: string;
    steps: ProceduralStep[];
  }): string {
    const id = randomUUID();
    try {
      this.db.prepare(
        `INSERT INTO procedural_memory (id, name, description, steps)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           description = excluded.description,
           steps = excluded.steps,
           updated_at = datetime('now')`,
      ).run(id, entry.name, entry.description, JSON.stringify(entry.steps));
    } catch (error) {
      logger.error("Failed to save procedural memory", error instanceof Error ? error : undefined);
    }
    return id;
  }

  get(name: string): ProceduralMemoryEntry | undefined {
    try {
      const row = this.db.prepare("SELECT * FROM procedural_memory WHERE name = ?").get(name) as any | undefined;
      return row ? deserializeProcedural(row) : undefined;
    } catch (error) {
      logger.error("Failed to get procedural memory", error instanceof Error ? error : undefined);
      return undefined;
    }
  }

  recordOutcome(name: string, success: boolean): void {
    try {
      const column = success ? "success_count" : "failure_count";
      this.db.prepare(
        `UPDATE procedural_memory
         SET ${column} = ${column} + 1, last_used_at = datetime('now'), updated_at = datetime('now')
         WHERE name = ?`,
      ).run(name);
    } catch (error) {
      logger.error("Failed to record procedural outcome", error instanceof Error ? error : undefined);
    }
  }

  search(query: string): ProceduralMemoryEntry[] {
    try {
      const escaped = query.replace(/[%_]/g, (char) => `\\${char}`);
      const rows = this.db.prepare(
        `SELECT * FROM procedural_memory
         WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
         ORDER BY success_count DESC, updated_at DESC`,
      ).all(`%${escaped}%`, `%${escaped}%`) as any[];
      return rows.map(deserializeProcedural);
    } catch (error) {
      logger.error("Failed to search procedural memory", error instanceof Error ? error : undefined);
      return [];
    }
  }

  delete(name: string): void {
    try {
      this.db.prepare("DELETE FROM procedural_memory WHERE name = ?").run(name);
    } catch (error) {
      logger.error("Failed to delete procedural memory", error instanceof Error ? error : undefined);
    }
  }
}

function deserializeProcedural(row: any): ProceduralMemoryEntry {
  let steps: ProceduralStep[] = [];
  try {
    steps = JSON.parse(row.steps || "[]");
  } catch {}
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps,
    successCount: row.success_count,
    failureCount: row.failure_count,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
