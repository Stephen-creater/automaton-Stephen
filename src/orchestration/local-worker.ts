import { createLogger } from "../observability/logger.js";
import { completeTask, failTask } from "./task-graph.js";
import type { TaskNode, TaskResult } from "./task-graph.js";

const logger = createLogger("orchestration.local-worker");

export class LocalWorkerPool {
  private readonly workers = new Map<string, { address: string; task?: TaskNode }>();

  constructor(private readonly options: { db: import("better-sqlite3").Database }) {}

  hasWorker(address: string): boolean {
    return this.workers.has(address);
  }

  spawn(task: { title?: string }): { address: string; name: string; sandboxId: string } {
    const suffix = Date.now().toString(36);
    const address = `local://worker-${suffix}`;
    this.workers.set(address, { address });
    return {
      address,
      name: task.title ? `worker-${task.title}` : `worker-${suffix}`,
      sandboxId: `local-${suffix}`,
    };
  }

  async runTask(address: string, task: TaskNode, executor: () => Promise<TaskResult>): Promise<void> {
    this.workers.set(address, { address, task });
    try {
      const result = await executor();
      completeTask(this.options.db, task.id, result);
    } catch (error) {
      failTask(this.options.db, task.id, error instanceof Error ? error.message : String(error), true);
      logger.error("Local worker task failed", error instanceof Error ? error : undefined);
    } finally {
      this.workers.set(address, { address });
    }
  }
}
