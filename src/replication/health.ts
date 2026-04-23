import type { Database as DatabaseType } from "better-sqlite3";
import type { ConwayClient, HealthCheckResult, ChildHealthConfig } from "../types.js";
import { DEFAULT_CHILD_HEALTH_CONFIG } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";

export { DEFAULT_CHILD_HEALTH_CONFIG };

export class ChildHealthMonitor {
  private readonly config: ChildHealthConfig;

  constructor(
    private readonly db: DatabaseType,
    private readonly conway: ConwayClient,
    private readonly lifecycle: ChildLifecycle,
    config?: Partial<ChildHealthConfig>,
  ) {
    this.config = { ...DEFAULT_CHILD_HEALTH_CONFIG, ...config };
  }

  async checkHealth(childId: string): Promise<HealthCheckResult> {
    const issues: string[] = [];
    let healthy = false;
    let lastSeen: string | null = null;
    let uptime: number | null = null;
    let creditBalance: number | null = null;

    try {
      const childRow = this.db.prepare("SELECT sandbox_id FROM children WHERE id = ?").get(childId) as { sandbox_id: string } | undefined;
      if (!childRow) {
        return { childId, healthy: false, lastSeen: null, uptime: null, creditBalance: null, issues: ["child not found"] };
      }

      const result = await this.conway.exec(
        `curl -sf http://localhost:3000/health 2>/dev/null || echo '{"status":"offline"}'`,
        10_000,
      );

      try {
        const status = JSON.parse(result.stdout.trim());
        if (status.status === "healthy" || status.status === "running") {
          healthy = true;
          lastSeen = new Date().toISOString();
          uptime = status.uptime ?? null;
          creditBalance = status.creditBalance ?? null;
        } else {
          issues.push(`status: ${status.status}`);
        }
      } catch {
        issues.push("failed to parse health check response");
      }
    } catch (error) {
      issues.push(`health check error: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      this.db.prepare("UPDATE children SET last_checked = datetime('now') WHERE id = ?").run(childId);
    } catch {}

    return { childId, healthy, lastSeen, uptime, creditBalance, issues };
  }

  async checkAllChildren(): Promise<HealthCheckResult[]> {
    const allChildren = [
      ...this.lifecycle.getChildrenInState("healthy"),
      ...this.lifecycle.getChildrenInState("unhealthy"),
    ];
    if (allChildren.length === 0) return [];
    const results: HealthCheckResult[] = [];
    const maxConcurrent = this.config.maxConcurrentChecks;

    for (let i = 0; i < allChildren.length; i += maxConcurrent) {
      const batch = allChildren.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch.map((child) => this.checkHealth(child.id)));
      for (const result of batchResults) {
        const child = allChildren.find((item) => item.id === result.childId);
        if (!child) continue;
        try {
          if (!result.healthy && child.status === "healthy") {
            this.lifecycle.transition(result.childId, "unhealthy", result.issues.join("; "));
          } else if (result.healthy && child.status === "unhealthy") {
            this.lifecycle.transition(result.childId, "healthy", "recovered");
          }
        } catch {}
        results.push(result);
      }
    }

    return results;
  }
}
