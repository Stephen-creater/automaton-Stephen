import type { Database as DatabaseType } from "better-sqlite3";
import type { ConwayClient } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("replication.cleanup");

export class SandboxCleanup {
  constructor(
    private readonly conway: ConwayClient,
    private readonly lifecycle: ChildLifecycle,
    private readonly db: DatabaseType,
  ) {}

  async cleanup(childId: string): Promise<void> {
    const state = this.lifecycle.getCurrentState(childId);
    if (state !== "stopped" && state !== "failed") {
      throw new Error(`Cannot clean up child in state: ${state}`);
    }
    const childRow = this.db.prepare("SELECT sandbox_id FROM children WHERE id = ?").get(childId) as { sandbox_id: string } | undefined;
    const note = childRow?.sandbox_id
      ? `sandbox ${childRow.sandbox_id} released (deletion disabled)`
      : "no sandbox to clean up";
    this.lifecycle.transition(childId, "cleaned_up", note);
  }

  async cleanupAll(): Promise<number> {
    const stale = [
      ...this.lifecycle.getChildrenInState("stopped"),
      ...this.lifecycle.getChildrenInState("failed"),
    ];
    let cleaned = 0;
    for (const child of stale) {
      try {
        await this.cleanup(child.id);
        cleaned += 1;
      } catch (error) {
        logger.error(`Failed to clean up child ${child.id}`, error instanceof Error ? error : undefined);
      }
    }
    return cleaned;
  }
}
