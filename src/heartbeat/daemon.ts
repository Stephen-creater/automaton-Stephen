import type {
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  AutomatonIdentity,
  HeartbeatConfig,
  HeartbeatTaskFn,
  HeartbeatLegacyContext,
  SocialClientInterface,
} from "../types.js";
import { BUILTIN_TASKS } from "./tasks.js";
import { DurableScheduler } from "./scheduler.js";
import { upsertHeartbeatSchedule } from "../state/database.js";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";
import { buildTickContext } from "./tick-context.js";

const logger = createLogger("heartbeat");
type DatabaseType = BetterSqlite3.Database;

export interface HeartbeatDaemonOptions {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  heartbeatConfig: HeartbeatConfig;
  db: AutomatonDatabase;
  rawDb: DatabaseType;
  conway: ConwayClient;
  social?: SocialClientInterface;
  onWakeRequest?: (reason: string) => void;
}

export interface HeartbeatDaemon {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  forceRun(taskName: string): Promise<void>;
}

export function createHeartbeatDaemon(
  options: HeartbeatDaemonOptions,
): HeartbeatDaemon {
  const { identity, config, heartbeatConfig, db, rawDb, conway, social, onWakeRequest } = options;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const legacyContext: HeartbeatLegacyContext = {
    identity,
    config,
    db,
    conway,
    social,
  };

  const taskMap = new Map<string, HeartbeatTaskFn>();
  for (const [name, fn] of Object.entries(BUILTIN_TASKS)) {
    taskMap.set(name, fn);
  }

  for (const entry of heartbeatConfig.entries) {
    upsertHeartbeatSchedule(rawDb, {
      taskName: entry.name,
      cronExpression: entry.schedule,
      intervalMs: null,
      enabled: entry.enabled ? 1 : 0,
      priority: 0,
      timeoutMs: 30_000,
      maxRetries: 1,
      tierMinimum: "dead",
      lastRunAt: entry.lastRun ?? null,
      nextRunAt: entry.nextRun ?? null,
      lastResult: null,
      lastError: null,
      runCount: 0,
      failCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  const scheduler = new DurableScheduler(
    rawDb,
    heartbeatConfig,
    taskMap,
    legacyContext,
    onWakeRequest,
  );

  const tickMs = heartbeatConfig.defaultIntervalMs ?? 60_000;

  function scheduleTick(): void {
    if (!running) return;
    timeoutId = setTimeout(async () => {
      try {
        await scheduler.tick();
      } catch (error) {
        logger.error("Tick failed", error instanceof Error ? error : undefined);
      }
      scheduleTick();
    }, tickMs);
  }

  const start = (): void => {
    if (running) return;
    running = true;
    scheduler.tick().catch((error) => {
      logger.error("First tick failed", error instanceof Error ? error : undefined);
    });
    scheduleTick();
    logger.info(`Daemon started. Tick interval: ${tickMs / 1000}s`);
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    logger.info("Daemon stopped.");
  };

  const isRunning = (): boolean => running;

  const forceRun = async (taskName: string): Promise<void> => {
    const context = await buildTickContext(rawDb, conway, heartbeatConfig, identity.address, identity.chainType);
    await scheduler.executeTask(taskName, context);
  };

  return { start, stop, isRunning, forceRun };
}
