import type { Database as DatabaseType } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChildLifecycleState, ChildLifecycleEventRow } from "../types.js";
import { VALID_TRANSITIONS } from "../types.js";
import {
  lifecycleInsertEvent,
  lifecycleGetEvents,
  lifecycleGetLatestState,
  getChildrenByStatus,
  updateChildStatus as dbUpdateChildStatus,
} from "../state/database.js";

export class ChildLifecycle {
  constructor(private readonly db: DatabaseType) {}

  initChild(childId: string, name: string, sandboxId: string, genesisPrompt: string, chainType?: string): void {
    this.db.prepare(
      `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, status, created_at, chain_type)
       VALUES (?, ?, '', ?, ?, 'requested', datetime('now'), ?)`,
    ).run(childId, name, sandboxId, genesisPrompt, chainType ?? "evm");

    const event: ChildLifecycleEventRow = {
      id: randomUUID(),
      childId,
      fromState: "none",
      toState: "requested",
      reason: "child created",
      metadata: "{}",
      createdAt: new Date().toISOString(),
    };
    lifecycleInsertEvent(this.db, event);
    dbUpdateChildStatus(this.db, childId, "requested");
  }

  transition(childId: string, toState: ChildLifecycleState, reason?: string, metadata?: Record<string, unknown>): void {
    const current = this.getCurrentState(childId);
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(toState)) {
      throw new Error(`Invalid lifecycle transition: ${current} → ${toState}`);
    }
    lifecycleInsertEvent(this.db, {
      id: randomUUID(),
      childId,
      fromState: current,
      toState,
      reason: reason ?? null,
      metadata: JSON.stringify(metadata ?? {}),
      createdAt: new Date().toISOString(),
    });
    dbUpdateChildStatus(this.db, childId, toState);
  }

  getCurrentState(childId: string): ChildLifecycleState {
    const state = lifecycleGetLatestState(this.db, childId);
    if (!state) throw new Error(`Child ${childId} not found in lifecycle events`);
    return state;
  }

  getHistory(childId: string): ChildLifecycleEventRow[] {
    return lifecycleGetEvents(this.db, childId);
  }

  getChildrenInState(state: ChildLifecycleState): Array<{ id: string; name: string; sandboxId: string; status: string; createdAt: string; lastChecked: string | null }> {
    const rows = getChildrenByStatus(this.db, state);
    return rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      sandboxId: row.sandbox_id,
      status: row.status,
      createdAt: row.created_at,
      lastChecked: row.last_checked ?? null,
    }));
  }
}
