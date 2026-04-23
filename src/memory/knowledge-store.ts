import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";

type Database = BetterSqlite3.Database;

export type KnowledgeCategory =
  | "market"
  | "technical"
  | "social"
  | "financial"
  | "operational";

export interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  key: string;
  content: string;
  source: string;
  confidence: number;
  lastVerified: string;
  accessCount: number;
  tokenCount: number;
  createdAt: string;
  expiresAt: string | null;
}

export class KnowledgeStore {
  constructor(private readonly db: Database) {}

  add(entry: Omit<KnowledgeEntry, "id" | "accessCount" | "createdAt">): string {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO knowledge_store (id, category, key, content, source, confidence, last_verified, access_count, token_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      entry.category,
      entry.key,
      entry.content,
      entry.source,
      entry.confidence,
      entry.lastVerified,
      0,
      entry.tokenCount,
      new Date().toISOString(),
      entry.expiresAt,
    );
    return id;
  }

  get(id: string): KnowledgeEntry | null {
    const now = new Date().toISOString();
    const row = this.db.prepare(
      `SELECT *
       FROM knowledge_store
       WHERE id = ? AND (expires_at IS NULL OR expires_at >= ?)`,
    ).get(id, now) as any | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE knowledge_store SET access_count = access_count + 1 WHERE id = ?").run(id);
    return toKnowledgeEntry({ ...row, access_count: row.access_count + 1 });
  }

  search(query: string, category?: KnowledgeCategory, limit: number = 100): KnowledgeEntry[] {
    const escaped = query.replace(/[%_]/g, (char) => `\\${char}`);
    const rows = category
      ? this.db.prepare(
          `SELECT * FROM knowledge_store
           WHERE category = ? AND (key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')
           ORDER BY confidence DESC, created_at DESC
           LIMIT ?`,
        ).all(category, `%${escaped}%`, `%${escaped}%`, limit)
      : this.db.prepare(
          `SELECT * FROM knowledge_store
           WHERE key LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
           ORDER BY confidence DESC, created_at DESC
           LIMIT ?`,
        ).all(`%${escaped}%`, `%${escaped}%`, limit);
    return (rows as any[]).map(toKnowledgeEntry);
  }

  update(id: string, updates: Partial<KnowledgeEntry>): void {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (updates.category !== undefined) { clauses.push("category = ?"); params.push(updates.category); }
    if (updates.key !== undefined) { clauses.push("key = ?"); params.push(updates.key); }
    if (updates.content !== undefined) { clauses.push("content = ?"); params.push(updates.content); }
    if (updates.source !== undefined) { clauses.push("source = ?"); params.push(updates.source); }
    if (updates.confidence !== undefined) { clauses.push("confidence = ?"); params.push(updates.confidence); }
    if (updates.lastVerified !== undefined) { clauses.push("last_verified = ?"); params.push(updates.lastVerified); }
    if (updates.accessCount !== undefined) { clauses.push("access_count = ?"); params.push(updates.accessCount); }
    if (updates.tokenCount !== undefined) { clauses.push("token_count = ?"); params.push(updates.tokenCount); }
    if (updates.expiresAt !== undefined) { clauses.push("expires_at = ?"); params.push(updates.expiresAt); }
    if (clauses.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE knowledge_store SET ${clauses.join(", ")} WHERE id = ?`).run(...params);
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM knowledge_store WHERE id = ?").run(id);
  }

  prune(): number {
    const now = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare(
      `DELETE FROM knowledge_store
       WHERE (expires_at IS NOT NULL AND expires_at < ?)
          OR (confidence < ? AND last_verified < ?)`,
    ).run(now, 0.3, sevenDaysAgo);
    return result.changes;
  }

  getByCategory(category: KnowledgeCategory): KnowledgeEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM knowledge_store WHERE category = ? ORDER BY confidence DESC, created_at DESC",
    ).all(category) as any[];
    return rows.map(toKnowledgeEntry);
  }
}

function toKnowledgeEntry(row: any): KnowledgeEntry {
  return {
    id: row.id,
    category: row.category,
    key: row.key,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    lastVerified: row.last_verified,
    accessCount: row.access_count,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
  };
}
