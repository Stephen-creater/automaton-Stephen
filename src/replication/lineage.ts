import type {
  AutomatonDatabase,
  ChildAutomaton,
  AutomatonConfig,
  ConwayClient,
} from "../types.js";
import type { ChildHealthMonitor } from "./health.js";
import type { SandboxCleanup } from "./cleanup.js";
import { deleteChild } from "../state/database.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("replication.lineage");

export function getLineage(db: AutomatonDatabase): {
  children: ChildAutomaton[];
  alive: number;
  dead: number;
  total: number;
} {
  const children = db.getChildren();
  const alive = children.filter((child) =>
    child.status === "running" || child.status === "sleeping" || child.status === "healthy",
  ).length;
  const dead = children.filter((child) =>
    child.status === "dead" || child.status === "failed" || child.status === "cleaned_up",
  ).length;

  return { children, alive, dead, total: children.length };
}

export function hasParent(config: AutomatonConfig): boolean {
  return !!config.parentAddress;
}

export function getLineageSummary(db: AutomatonDatabase, config: AutomatonConfig): string {
  const lineage = getLineage(db);
  const parts: string[] = [];
  if (hasParent(config)) {
    parts.push(`Parent: ${config.parentAddress}`);
  }
  if (lineage.total > 0) {
    parts.push(`Children: ${lineage.total} total (${lineage.alive} alive, ${lineage.dead} dead)`);
    for (const child of lineage.children) {
      parts.push(`  - ${child.name} [${child.status}] sandbox:${child.sandboxId}`);
    }
  }
  return parts.length > 0 ? parts.join("\n") : "No lineage (first generation)";
}

export async function pruneDeadChildren(
  db: AutomatonDatabase,
  cleanup?: SandboxCleanup,
  keepLast: number = 5,
): Promise<number> {
  const dead = db.getChildren().filter((child) =>
    child.status === "dead" || child.status === "failed" || child.status === "stopped",
  );
  if (dead.length <= keepLast) return 0;

  dead.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const toRemove = dead.slice(0, dead.length - keepLast);
  let removed = 0;
  for (const child of toRemove) {
    try {
      if (cleanup) {
        try { await cleanup.cleanup(child.id); } catch {}
      }
      deleteChild(db.raw, child.id);
      removed += 1;
    } catch (error) {
      logger.error(`Failed to prune child ${child.id}`, error instanceof Error ? error : undefined);
    }
  }
  return removed;
}

export async function refreshChildrenStatus(
  conway: ConwayClient,
  db: AutomatonDatabase,
  healthMonitor?: ChildHealthMonitor,
): Promise<void> {
  if (healthMonitor) {
    await healthMonitor.checkAllChildren();
    return;
  }

  const children = db.getChildren().filter((child) => child.status !== "dead" && child.status !== "cleaned_up");
  for (const child of children) {
    try {
      const result = await conway.exec("echo alive", 10_000);
      if (result.exitCode !== 0) {
        db.updateChildStatus(child.id, "unknown" as any);
      }
    } catch {
      db.updateChildStatus(child.id, "unknown" as any);
    }
  }
}
