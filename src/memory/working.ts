import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { WorkingMemoryEntry, WorkingMemoryType } from "../types.js";
import { estimateTokens } from "../agent/context.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.working");
type Database = BetterSqlite3.Database;

export class WorkingMemoryManager {
  constructor(private readonly db: Database) {}

  add(entry: {
    sessionId: string;
    content: string;
    contentType: WorkingMemoryType;
    priority?: number;
    expiresAt?: string | null;
    sourceTurn?: string | null;
  }): string {
    const id = randomUUID();
    try {
      this.db.prepare(
        `INSERT INTO working_memory (id, session_id, content, content_type, priority, token_count, expires_at, source_turn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        entry.sessionId,
        entry.content,
        entry.contentType,
        entry.priority ?? 0.5,
        estimateTokens(entry.content),
        entry.expiresAt ?? null,
        entry.sourceTurn ?? null,
      );
    } catch (error) {
      logger.error("Failed to add working memory", error instanceof Error ? error : undefined);
    }
    return id;
  }

  getBySession(sessionId: string): WorkingMemoryEntry[] {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM working_memory WHERE session_id = ? ORDER BY priority DESC, created_at DESC",
      ).all(sessionId) as any[];
      return rows.map(deserializeWorkingMemory);
    } catch (error) {
      logger.error("Failed to get working memory", error instanceof Error ? error : undefined);
      return [];
    }
  }

  update(
    id: string,
    updates: Partial<Pick<WorkingMemoryEntry, "content" | "priority" | "expiresAt" | "contentType">>,
  ): void {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (updates.content !== undefined) {
      clauses.push("content = ?", "token_count = ?");
      params.push(updates.content, estimateTokens(updates.content));
    }
    if (updates.priority !== undefined) {
      clauses.push("priority = ?");
      params.push(updates.priority);
    }
    if (updates.expiresAt !== undefined) {
      clauses.push("expires_at = ?");
      params.push(updates.expiresAt);
    }
    if (updates.contentType !== undefined) {
      clauses.push("content_type = ?");
      params.push(updates.contentType);
    }

    if (clauses.length === 0) return;
    params.push(id);

    try {
      this.db.prepare(`UPDATE working_memory SET ${clauses.join(", ")} WHERE id = ?`).run(...params);
    } catch (error) {
      logger.error("Failed to update working memory", error instanceof Error ? error : undefined);
    }
  }

  delete(id: string): void {
    try {
      this.db.prepare("DELETE FROM working_memory WHERE id = ?").run(id);
    } catch (error) {
      logger.error("Failed to delete working memory", error instanceof Error ? error : undefined);
    }
  }

  prune(sessionId: string, maxEntries: number = 20): number {
    if (maxEntries < 0) return 0;
    try {
      const count = this.db.prepare(
        "SELECT COUNT(*) as cnt FROM working_memory WHERE session_id = ?",
      ).get(sessionId) as { cnt: number };
      if (count.cnt <= maxEntries) return 0;
      const toRemove = count.cnt - maxEntries;
      const result = this.db.prepare(
        `DELETE FROM working_memory WHERE id IN (
          SELECT id FROM working_memory WHERE session_id = ?
          ORDER BY priority ASC, created_at ASC
          LIMIT ?
        )`,
      ).run(sessionId, toRemove);
      return result.changes;
    } catch (error) {
      logger.error("Failed to prune working memory", error instanceof Error ? error : undefined);
      return 0;
    }
  }

  clearExpired(): number {
    try {
      const result = this.db.prepare(
        "DELETE FROM working_memory WHERE expires_at IS NOT NULL AND expires_at < datetime('now')",
      ).run();
      return result.changes;
    } catch (error) {
      logger.error("Failed to clear expired working memory", error instanceof Error ? error : undefined);
      return 0;
    }
  }
}

function deserializeWorkingMemory(row: any): WorkingMemoryEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    contentType: row.content_type,
    priority: row.priority,
    tokenCount: row.token_count,
    expiresAt: row.expires_at ?? null,
    sourceTurn: row.source_turn ?? null,
    createdAt: row.created_at,
  };
}
