import type BetterSqlite3 from "better-sqlite3";
import { randomUUID } from "node:crypto";

type Database = BetterSqlite3.Database;

export type EventType =
  | "user_input"
  | "plan_created"
  | "plan_updated"
  | "task_assigned"
  | "task_completed"
  | "task_failed"
  | "action"
  | "observation"
  | "inference"
  | "financial"
  | "agent_spawned"
  | "agent_died"
  | "knowledge"
  | "market_signal"
  | "revenue"
  | "error"
  | "reflection";

export interface StreamEvent {
  id: string;
  type: EventType;
  agentAddress: string;
  goalId: string | null;
  taskId: string | null;
  content: string;
  tokenCount: number;
  compactedTo: string | null;
  createdAt: string;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 3.5);
}

export class EventStream {
  constructor(private readonly db: Database) {}

  append(event: Omit<StreamEvent, "id" | "createdAt">): string {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO event_stream (id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      event.type,
      event.agentAddress,
      event.goalId,
      event.taskId,
      event.content,
      event.tokenCount === 0 ? estimateTokens(event.content) : event.tokenCount,
      event.compactedTo,
      createdAt,
    );
    return id;
  }

  getRecent(agentAddress: string, limit: number = 50): StreamEvent[] {
    const rows = this.db.prepare(
      `SELECT id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at
       FROM event_stream
       WHERE agent_address = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(agentAddress, limit) as any[];
    return rows.map(toStreamEvent).reverse();
  }

  getByGoal(goalId: string): StreamEvent[] {
    const rows = this.db.prepare(
      `SELECT id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at
       FROM event_stream
       WHERE goal_id = ?
       ORDER BY created_at ASC`,
    ).all(goalId) as any[];
    return rows.map(toStreamEvent);
  }

  getByType(type: EventType, since?: string): StreamEvent[] {
    const rows = since
      ? this.db.prepare(
          `SELECT id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at
           FROM event_stream
           WHERE type = ? AND created_at >= ?
           ORDER BY created_at ASC`,
        ).all(type, since)
      : this.db.prepare(
          `SELECT id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at
           FROM event_stream
           WHERE type = ?
           ORDER BY created_at ASC`,
        ).all(type);
    return (rows as any[]).map(toStreamEvent);
  }

  getTokenCount(agentAddress: string, since?: string): number {
    const row = since
      ? this.db.prepare(
          `SELECT COALESCE(SUM(token_count), 0) AS total
           FROM event_stream
           WHERE agent_address = ? AND created_at >= ?`,
        ).get(agentAddress, since)
      : this.db.prepare(
          `SELECT COALESCE(SUM(token_count), 0) AS total
           FROM event_stream
           WHERE agent_address = ?`,
        ).get(agentAddress);
    return (row as { total: number }).total ?? 0;
  }

  prune(olderThan: string): number {
    const result = this.db.prepare(
      "DELETE FROM event_stream WHERE created_at < ?",
    ).run(olderThan);
    return result.changes;
  }
}

function toStreamEvent(row: any): StreamEvent {
  return {
    id: row.id,
    type: row.type,
    agentAddress: row.agent_address,
    goalId: row.goal_id,
    taskId: row.task_id,
    content: row.content,
    tokenCount: row.token_count,
    compactedTo: row.compacted_to,
    createdAt: row.created_at,
  };
}
