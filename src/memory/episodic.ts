import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { EpisodicMemoryEntry, TurnClassification } from "../types.js";
import { estimateTokens } from "../agent/context.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.episodic");
type Database = BetterSqlite3.Database;

export class EpisodicMemoryManager {
  constructor(private readonly db: Database) {}

  record(entry: {
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: string | null;
    outcome?: "success" | "failure" | "partial" | "neutral" | null;
    importance?: number;
    embeddingKey?: string | null;
    classification?: TurnClassification;
  }): string {
    const id = randomUUID();
    try {
      this.db.prepare(
        `INSERT INTO episodic_memory (id, session_id, event_type, summary, detail, outcome, importance, embedding_key, token_count, classification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        entry.sessionId,
        entry.eventType,
        entry.summary,
        entry.detail ?? null,
        entry.outcome ?? null,
        entry.importance ?? 0.5,
        entry.embeddingKey ?? null,
        estimateTokens(entry.summary + (entry.detail || "")),
        entry.classification ?? "maintenance",
      );
    } catch (error) {
      logger.error("Failed to record episodic memory", error instanceof Error ? error : undefined);
    }
    return id;
  }

  getRecent(sessionId: string, limit: number = 10): EpisodicMemoryEntry[] {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM episodic_memory WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
      ).all(sessionId, limit) as any[];
      return rows.map(deserializeEpisodic);
    } catch (error) {
      logger.error("Failed to get recent episodic memory", error instanceof Error ? error : undefined);
      return [];
    }
  }

  search(query: string, limit: number = 10): EpisodicMemoryEntry[] {
    try {
      const escaped = query.replace(/[%_]/g, (char) => `\\${char}`);
      const rows = this.db.prepare(
        `SELECT * FROM episodic_memory
         WHERE summary LIKE ? ESCAPE '\\' OR detail LIKE ? ESCAPE '\\'
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`,
      ).all(`%${escaped}%`, `%${escaped}%`, limit) as any[];
      return rows.map(deserializeEpisodic);
    } catch (error) {
      logger.error("Failed to search episodic memory", error instanceof Error ? error : undefined);
      return [];
    }
  }

  markAccessed(id: string): void {
    try {
      this.db.prepare(
        "UPDATE episodic_memory SET accessed_count = accessed_count + 1, last_accessed_at = datetime('now') WHERE id = ?",
      ).run(id);
    } catch (error) {
      logger.error("Failed to mark episodic memory accessed", error instanceof Error ? error : undefined);
    }
  }

  prune(retentionDays: number): number {
    if (retentionDays <= 0) return 0;
    try {
      const result = this.db.prepare(
        "DELETE FROM episodic_memory WHERE created_at < datetime('now', ?)",
      ).run(`-${retentionDays} days`);
      return result.changes;
    } catch (error) {
      logger.error("Failed to prune episodic memory", error instanceof Error ? error : undefined);
      return 0;
    }
  }

  summarizeSession(sessionId: string): string {
    const entries = this.getRecent(sessionId, 100).reverse();
    if (entries.length === 0) {
      return "No activity recorded for this session.";
    }

    const summaryLines: string[] = [`Session had ${entries.length} recorded event(s).`];
    const successes = entries.filter((entry) => entry.outcome === "success").length;
    const failures = entries.filter((entry) => entry.outcome === "failure").length;
    if (successes > 0) summaryLines.push(`${successes} successful outcome(s).`);
    if (failures > 0) summaryLines.push(`${failures} failed outcome(s).`);
    summaryLines.push("Key events:");
    for (const entry of [...entries].sort((a, b) => b.importance - a.importance).slice(0, 3)) {
      summaryLines.push(`- [${entry.eventType}] ${entry.summary}`);
    }
    return summaryLines.join("\n");
  }
}

function deserializeEpisodic(row: any): EpisodicMemoryEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    summary: row.summary,
    detail: row.detail ?? null,
    outcome: row.outcome ?? null,
    importance: row.importance,
    embeddingKey: row.embedding_key ?? null,
    tokenCount: row.token_count,
    accessedCount: row.accessed_count,
    lastAccessedAt: row.last_accessed_at ?? null,
    classification: row.classification,
    createdAt: row.created_at,
  };
}
