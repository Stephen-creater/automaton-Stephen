import type BetterSqlite3 from "better-sqlite3";
import type {
  HeartbeatConfig,
  HeartbeatTaskFn,
  HeartbeatLegacyContext,
  HeartbeatScheduleRow,
  TickContext,
} from "../types.js";
import { buildTickContext } from "./tick-context.js";
import {
  getHeartbeatSchedule,
  updateHeartbeatSchedule,
  insertHeartbeatHistory,
  acquireTaskLease,
  releaseTaskLease,
  clearExpiredLeases,
  pruneExpiredDedupKeys,
  insertWakeEvent,
} from "../state/database.js";
import { createLogger } from "../observability/logger.js";

type DatabaseType = BetterSqlite3.Database;
const logger = createLogger("heartbeat.scheduler");

const DEFAULT_TASK_TIMEOUT_MS = 30_000;
const LEASE_TTL_MS = 60_000;

let historyCounter = 0;
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  historyCounter += 1;
  return `${timestamp}-${random}-${historyCounter.toString(36)}`;
}

function timeoutPromise(ms: number): { promise: Promise<never>; clear: () => void } {
  let timerId: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms);
  });
  return {
    promise,
    clear: () => clearTimeout(timerId),
  };
}

function isCronDue(cronExpression: string, now: Date): boolean {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    matchCronField(parts[0], now.getMinutes()) &&
    matchCronField(parts[1], now.getHours()) &&
    matchCronField(parts[2], now.getDate()) &&
    matchCronField(parts[3], now.getMonth() + 1) &&
    matchCronDayField(parts[4], now.getDay())
  );
}

function matchCronField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (/^\*\/\d+$/.test(field)) {
    const interval = Number(field.slice(2));
    return interval > 0 && value % interval === 0;
  }
  if (field.includes(",")) {
    return field.split(",").some((part) => matchCronField(part, value));
  }
  if (/^\d+-\d+$/.test(field)) {
    const [start, end] = field.split("-").map(Number);
    return value >= start && value <= end;
  }
  const numeric = Number(field);
  return Number.isInteger(numeric) && numeric === value;
}

function matchCronDayField(field: string, day: number): boolean {
  if (field === "*") return true;
  return matchCronField(field, day === 0 ? 7 : day);
}

const TIER_ORDER: Record<string, number> = {
  dead: 0,
  critical: 1,
  low_compute: 2,
  normal: 3,
  high: 4,
};

function tierMeetsMinimum(currentTier: string, minimumTier: string): boolean {
  return (TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[minimumTier] ?? 0);
}

export class DurableScheduler {
  private tickInProgress = false;
  private readonly ownerId: string;

  constructor(
    private readonly db: DatabaseType,
    private readonly config: HeartbeatConfig,
    private readonly tasks: Map<string, HeartbeatTaskFn>,
    private readonly legacyContext: HeartbeatLegacyContext,
    private readonly onWakeRequest?: (reason: string) => void,
  ) {
    this.ownerId = `scheduler-${Date.now().toString(36)}`;
  }

  async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;

    try {
      clearExpiredLeases(this.db);
      const context = await buildTickContext(
        this.db,
        this.legacyContext.conway,
        this.config,
        this.legacyContext.identity.address,
        this.legacyContext.identity.chainType,
      );
      const dueTasks = this.getDueTasks(context);
      for (const task of dueTasks) {
        await this.executeTask(task.taskName, context);
      }
      pruneExpiredDedupKeys(this.db);
    } catch (error) {
      logger.error("Tick failed", error instanceof Error ? error : undefined);
    } finally {
      this.tickInProgress = false;
    }
  }

  getDueTasks(context: TickContext): HeartbeatScheduleRow[] {
    const schedule = getHeartbeatSchedule(this.db);
    const now = new Date();

    return schedule.filter((row) => {
      if (!row.enabled) return false;
      if (!tierMeetsMinimum(context.survivalTier, row.tierMinimum)) return false;
      if (row.leaseOwner && row.leaseOwner !== this.ownerId) {
        if (row.leaseExpiresAt && new Date(row.leaseExpiresAt) > now) return false;
      }
      if (row.nextRunAt && new Date(row.nextRunAt) <= now) return true;
      if (row.intervalMs) {
        if (!row.lastRunAt) return true;
        return now.getTime() - new Date(row.lastRunAt).getTime() >= row.intervalMs;
      }
      return isCronDue(row.cronExpression, now);
    });
  }

  async executeTask(taskName: string, ctx: TickContext): Promise<void> {
    const taskFn = this.tasks.get(taskName);
    if (!taskFn) return;

    const schedule = getHeartbeatSchedule(this.db).find((row) => row.taskName === taskName);
    const timeoutMs = schedule?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    if (!this.acquireLease(taskName)) return;

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const timeout = timeoutPromise(timeoutMs);

    try {
      const result = await Promise.race([
        taskFn(ctx, this.legacyContext),
        timeout.promise,
      ]);

      const durationMs = Date.now() - startMs;
      this.recordSuccess(taskName, durationMs, startedAt);

      if (result.shouldWake) {
        const reason = result.message || `Heartbeat task '${taskName}' requested wake`;
        this.onWakeRequest?.(reason);
        insertWakeEvent(this.db, "heartbeat", reason, { taskName });
      }
    } catch (error) {
      const durationMs = Date.now() - startMs;
      const err = error instanceof Error ? error : new Error(String(error));
      const isTimeout = err.message.includes("timed out");
      this.recordFailure(taskName, err, durationMs, startedAt, isTimeout ? "timeout" : "failure");
      if (schedule && schedule.maxRetries > 0 && this.getRecentFailures(taskName) < schedule.maxRetries) {
        this.scheduleRetry(taskName);
      }
    } finally {
      timeout.clear();
      this.releaseLease(taskName);
    }
  }

  acquireLease(taskName: string): boolean {
    return acquireTaskLease(this.db, taskName, this.ownerId, LEASE_TTL_MS);
  }

  releaseLease(taskName: string): void {
    releaseTaskLease(this.db, taskName, this.ownerId);
  }

  recordSuccess(taskName: string, durationMs: number, startedAt: string): void {
    const now = new Date().toISOString();
    insertHeartbeatHistory(this.db, {
      id: generateId(),
      taskName,
      startedAt,
      completedAt: now,
      result: "success",
      durationMs,
      error: null,
      idempotencyKey: null,
    });

    updateHeartbeatSchedule(this.db, taskName, {
      lastRunAt: now,
      nextRunAt: null,
      lastResult: "success",
      lastError: null,
      runCount: this.getRunCount(taskName) + 1,
    });
  }

  recordFailure(
    taskName: string,
    error: Error,
    durationMs: number,
    startedAt: string,
    result: "failure" | "timeout" = "failure",
  ): void {
    const now = new Date().toISOString();
    insertHeartbeatHistory(this.db, {
      id: generateId(),
      taskName,
      startedAt,
      completedAt: now,
      result,
      durationMs,
      error: error.message,
      idempotencyKey: null,
    });
    updateHeartbeatSchedule(this.db, taskName, {
      lastRunAt: now,
      lastResult: result,
      lastError: error.message,
      failCount: this.getFailCount(taskName) + 1,
      runCount: this.getRunCount(taskName) + 1,
    });
  }

  private getRunCount(taskName: string): number {
    const row = this.db.prepare("SELECT run_count FROM heartbeat_schedule WHERE task_name = ?").get(taskName) as { run_count: number } | undefined;
    return row?.run_count ?? 0;
  }

  private getFailCount(taskName: string): number {
    const row = this.db.prepare("SELECT fail_count FROM heartbeat_schedule WHERE task_name = ?").get(taskName) as { fail_count: number } | undefined;
    return row?.fail_count ?? 0;
  }

  private getRecentFailures(taskName: string): number {
    const rows = this.db.prepare(
      `SELECT result FROM heartbeat_history
       WHERE task_name = ? ORDER BY started_at DESC LIMIT 10`,
    ).all(taskName) as { result: string }[];

    let count = 0;
    for (const row of rows) {
      if (row.result === "success") break;
      count += 1;
    }
    return count;
  }

  private scheduleRetry(taskName: string): void {
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    updateHeartbeatSchedule(this.db, taskName, { nextRunAt: retryAt });
  }

  pruneHistory(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const result = this.db.prepare(
      "DELETE FROM heartbeat_history WHERE started_at < ?",
    ).run(cutoff);
    return result.changes;
  }
}
