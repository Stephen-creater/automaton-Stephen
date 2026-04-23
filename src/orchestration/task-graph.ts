import type { Database } from "better-sqlite3";
import {
  getGoalById,
  getReadyTasks as getReadyTaskRows,
  getTaskById,
  insertGoal,
  insertTask,
  updateGoalStatus,
  updateTaskStatus,
  withTransaction,
  getTasksByGoal,
  type GoalRow,
  type TaskGraphRow,
} from "../state/database.js";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type GoalStatus = "active" | "completed" | "failed" | "paused";

export interface TaskResult {
  success: boolean;
  output: string;
  artifacts: string[];
  costCents: number;
  duration: number;
}

export interface TaskNode {
  id: string;
  parentId: string | null;
  goalId: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo: string | null;
  agentRole: string | null;
  priority: number;
  dependencies: string[];
  result: TaskResult | null;
  metadata: {
    estimatedCostCents: number;
    actualCostCents: number;
    maxRetries: number;
    retryCount: number;
    timeoutMs: number;
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  strategy: string | null;
  rootTasks: string[];
  expectedRevenueCents: number;
  actualRevenueCents: number;
  createdAt: string;
  deadline: string | null;
}

export function createGoal(db: Database, title: string, description: string, strategy?: string): Goal {
  const id = insertGoal(db, { title: title.trim(), description: description.trim(), strategy: strategy ?? null });
  const row = getGoalById(db, id);
  if (!row) throw new Error(`Failed to load goal after insertion: ${id}`);
  return goalRowToGoal(row, []);
}

export function decomposeGoal(
  db: Database,
  goalId: string,
  tasks: Omit<TaskNode, "id" | "metadata">[],
): void {
  if (!getGoalById(db, goalId)) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  withTransaction(db, () => {
    for (const task of tasks) {
      insertTask(db, {
        parentId: task.parentId,
        goalId,
        title: task.title,
        description: task.description,
        status: task.status,
        assignedTo: task.assignedTo,
        agentRole: task.agentRole,
        priority: task.priority,
        dependencies: task.dependencies,
        result: task.result,
      });
    }
  });
}

export function getReadyTasks(db: Database): TaskNode[] {
  return getReadyTaskRows(db).map(taskRowToTaskNode);
}

export function assignTask(db: Database, taskId: string, agentAddress: string): void {
  withTransaction(db, () => {
    updateTaskStatus(db, taskId, "assigned");
    db.prepare("UPDATE task_graph SET assigned_to = ? WHERE id = ?").run(agentAddress, taskId);
  });
}

export function completeTask(db: Database, taskId: string, result: TaskResult): void {
  withTransaction(db, () => {
    updateTaskStatus(db, taskId, "completed");
    db.prepare(
      "UPDATE task_graph SET result = ?, actual_cost_cents = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
    ).run(JSON.stringify(result), result.costCents, new Date().toISOString(), taskId);

    const task = getTaskById(db, taskId);
    if (task) refreshGoalStatus(db, task.goalId);
  });
}

export function failTask(db: Database, taskId: string, error: string, shouldRetry: boolean): void {
  const task = getTaskById(db, taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const failureResult: TaskResult = {
    success: false,
    output: error,
    artifacts: [],
    costCents: task.actualCostCents,
    duration: 0,
  };

  withTransaction(db, () => {
    if (shouldRetry && task.retryCount < task.maxRetries) {
      db.prepare(
        `UPDATE task_graph
         SET status = ?, retry_count = ?, assigned_to = NULL, started_at = NULL, completed_at = NULL, result = ?
         WHERE id = ?`,
      ).run("pending", task.retryCount + 1, JSON.stringify(failureResult), taskId);
      return;
    }

    updateTaskStatus(db, taskId, "failed");
    db.prepare("UPDATE task_graph SET result = ?, assigned_to = NULL WHERE id = ?").run(JSON.stringify(failureResult), taskId);
    refreshGoalStatus(db, task.goalId);
  });
}

export function getGoalProgress(db: Database, goalId: string): { total: number; completed: number; failed: number } {
  const tasks = getTasksByGoal(db, goalId);
  return {
    total: tasks.length,
    completed: tasks.filter((task) => task.status === "completed").length,
    failed: tasks.filter((task) => task.status === "failed").length,
  };
}

export function normalizeTaskResult(input: Partial<TaskResult>): TaskResult {
  return {
    success: Boolean(input.success),
    output: input.output ?? "",
    artifacts: input.artifacts ?? [],
    costCents: input.costCents ?? 0,
    duration: input.duration ?? 0,
  };
}

function refreshGoalStatus(db: Database, goalId: string): void {
  const tasks = getTasksByGoal(db, goalId);
  if (tasks.length === 0) return;
  if (tasks.every((task) => task.status === "completed")) {
    updateGoalStatus(db, goalId, "completed");
  } else if (tasks.some((task) => task.status === "failed")) {
    updateGoalStatus(db, goalId, "failed");
  } else {
    updateGoalStatus(db, goalId, "active");
  }
}

function goalRowToGoal(row: GoalRow, tasks: TaskGraphRow[]): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    strategy: row.strategy,
    rootTasks: tasks.filter((task) => !task.parentId).map((task) => task.id),
    expectedRevenueCents: row.expectedRevenueCents,
    actualRevenueCents: row.actualRevenueCents,
    createdAt: row.createdAt,
    deadline: row.deadline,
  };
}

function taskRowToTaskNode(row: TaskGraphRow): TaskNode {
  return {
    id: row.id,
    parentId: row.parentId,
    goalId: row.goalId,
    title: row.title,
    description: row.description,
    status: row.status,
    assignedTo: row.assignedTo,
    agentRole: row.agentRole,
    priority: row.priority,
    dependencies: row.dependencies,
    result: row.result as TaskResult | null,
    metadata: {
      estimatedCostCents: row.estimatedCostCents,
      actualCostCents: row.actualCostCents,
      maxRetries: row.maxRetries,
      retryCount: row.retryCount,
      timeoutMs: row.timeoutMs,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    },
  };
}
