import type { AutomatonIdentity } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  assignTask,
  completeTask,
  decomposeGoal,
  failTask,
  getGoalProgress,
  getReadyTasks,
  type Goal,
  type TaskNode,
  type TaskResult,
  normalizeTaskResult,
} from "./task-graph.js";
import { planGoal, replanAfterFailure, type PlannerContext, type PlannedTask } from "./planner.js";
import { ColonyMessaging, type AgentMessage } from "./messaging.js";
import { generateTodoMd } from "./attention.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { reviewPlan } from "./plan-mode.js";
import {
  getActiveGoals,
  getGoalById,
  getTaskById,
  getTasksByGoal,
  updateGoalStatus,
} from "../state/database.js";
import type { AgentAssignment, AgentTracker, FundingProtocol, OrchestratorTickResult } from "./types.js";

const logger = createLogger("orchestration.orchestrator");

type ExecutionPhase =
  | "idle"
  | "classifying"
  | "planning"
  | "plan_review"
  | "executing"
  | "replanning"
  | "complete"
  | "failed";

interface OrchestratorState {
  phase: ExecutionPhase;
  goalId: string | null;
  replanCount: number;
  failedTaskId: string | null;
  failedError: string | null;
}

const DEFAULT_STATE: OrchestratorState = {
  phase: "idle",
  goalId: null,
  replanCount: 0,
  failedTaskId: null,
  failedError: null,
};

export class Orchestrator {
  constructor(private readonly params: {
    db: import("better-sqlite3").Database;
    agentTracker: AgentTracker;
    funding: FundingProtocol;
    messaging: ColonyMessaging;
    inference: UnifiedInferenceClient;
    identity: AutomatonIdentity;
    config: any;
    isWorkerAlive?: (address: string) => boolean;
    workerPool?: any;
  }) {}

  async tick(): Promise<OrchestratorTickResult> {
    const counters = { tasksAssigned: 0, tasksCompleted: 0, tasksFailed: 0 };
    let state = this.loadState();

    try {
      switch (state.phase) {
        case "idle":
          state = this.handleIdlePhase(state);
          break;
        case "classifying":
          state = this.handleClassifyingPhase(state);
          break;
        case "planning":
          state = await this.handlePlanningPhase(state);
          break;
        case "plan_review":
          state = await this.handlePlanReviewPhase(state);
          break;
        case "executing":
          state = await this.handleExecutingPhase(state, counters);
          break;
        case "replanning":
          state = await this.handleReplanningPhase(state);
          break;
        case "complete":
          state = this.handleCompletePhase(state);
          break;
        case "failed":
          state = this.handleFailedPhase(state);
          break;
      }
    } catch (error) {
      logger.error("Orchestrator tick failed", error instanceof Error ? error : undefined, {
        phase: state.phase,
        goalId: state.goalId,
      });
      if (state.goalId) {
        updateGoalStatus(this.params.db, state.goalId, "failed");
      }
      state = { ...state, phase: "failed", failedError: error instanceof Error ? error.message : String(error) };
    }

    this.saveState(state);
    this.persistTodo();

    return {
      phase: state.phase,
      tasksAssigned: counters.tasksAssigned,
      tasksCompleted: counters.tasksCompleted,
      tasksFailed: counters.tasksFailed,
      goalsActive: getActiveGoals(this.params.db).length,
      agentsActive: this.getActiveAgentCount(),
    };
  }

  async matchTaskToAgent(task: TaskNode): Promise<AgentAssignment> {
    const requestedRole = task.agentRole?.trim() || "generalist";
    const idle = this.params.agentTracker.getIdle();
    const direct = idle.find((agent) => agent.role === requestedRole);
    if (direct) {
      return { agentAddress: direct.address, agentName: direct.name, spawned: false };
    }

    const best = this.params.agentTracker.getBestForTask(requestedRole);
    if (best) {
      return { agentAddress: best.address, agentName: best.name, spawned: false };
    }

    if (this.params.identity?.address) {
      return {
        agentAddress: this.params.identity.address,
        agentName: this.params.identity.name,
        spawned: false,
      };
    }

    throw new Error(`No available agent for task ${task.id}`);
  }

  async fundAgentForTask(addr: string, task: TaskNode): Promise<void> {
    const estimated = Math.max(0, task.metadata.estimatedCostCents);
    if (estimated > 0 && addr !== this.params.identity.address) {
      const result = await this.params.funding.fundChild(addr, estimated);
      if (!result.success) {
        throw new Error(`Funding transfer failed for ${addr}`);
      }
    }
  }

  async collectResults(): Promise<TaskResult[]> {
    const processed = await this.params.messaging.processInbox();
    const results: TaskResult[] = [];
    for (const entry of processed) {
      if (!entry.success || entry.message.type !== "task_result") continue;
      results.push(
        normalizeTaskResult({
          success: true,
          output: entry.message.content,
          artifacts: [],
          costCents: 0,
          duration: 0,
        }),
      );
    }
    return results;
  }

  async handleFailure(task: TaskNode, error: string): Promise<void> {
    failTask(this.params.db, task.id, error, true);
    const latest = getTaskById(this.params.db, task.id);
    if (!latest || latest.status !== "failed") return;
    const state = this.loadState();
    this.saveState({
      ...state,
      phase: "replanning",
      goalId: task.goalId,
      failedTaskId: task.id,
      failedError: error,
    });
  }

  private handleIdlePhase(state: OrchestratorState): OrchestratorState {
    const activeGoals = getActiveGoals(this.params.db);
    if (activeGoals.length === 0) {
      return { ...state, phase: "idle", goalId: null };
    }
    return {
      ...state,
      phase: "classifying",
      goalId: activeGoals[0].id,
      failedTaskId: null,
      failedError: null,
    };
  }

  private handleClassifyingPhase(state: OrchestratorState): OrchestratorState {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goal = getGoalById(this.params.db, state.goalId);
    if (!goal) return { ...state, phase: "idle", goalId: null };
    const tasks = getTasksByGoal(this.params.db, goal.id);
    if (tasks.length > 0) return { ...state, phase: "executing" };
    return { ...state, phase: "planning" };
  }

  private async handlePlanningPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId) return { ...state, phase: "idle" };
    const goalRow = getGoalById(this.params.db, state.goalId);
    if (!goalRow) return { ...state, phase: "idle", goalId: null };
    const goal: Goal = {
      id: goalRow.id,
      title: goalRow.title,
      description: goalRow.description,
      status: goalRow.status,
      strategy: goalRow.strategy,
      rootTasks: [],
      expectedRevenueCents: goalRow.expectedRevenueCents,
      actualRevenueCents: goalRow.actualRevenueCents,
      createdAt: goalRow.createdAt,
      deadline: goalRow.deadline,
    };
    const context = this.buildPlannerContext();
    const plan = await planGoal(goal, context, this.params.inference);
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run("orchestrator.pending_plan", JSON.stringify(plan));
    return { ...state, phase: "plan_review" };
  }

  private async handlePlanReviewPhase(state: OrchestratorState): Promise<OrchestratorState> {
    const row = this.params.db.prepare("SELECT value FROM kv WHERE key = ?").get("orchestrator.pending_plan") as { value: string } | undefined;
    if (!row?.value || !state.goalId) {
      return { ...state, phase: "failed", failedError: "Missing pending plan" };
    }
    const plan = JSON.parse(row.value);
    await reviewPlan(plan, {
      mode: "auto",
      autoBudgetThreshold: 5000,
      consensusCriticRole: "reviewer",
      reviewTimeoutMs: 30 * 60_000,
    });
    const goalId = state.goalId;
    const tasks: Omit<TaskNode, "id" | "metadata">[] = (plan.tasks as PlannedTask[]).map((task) => ({
      parentId: null,
      goalId,
      title: task.title,
      description: task.description,
      status: "pending",
      assignedTo: null,
      agentRole: task.agentRole,
      priority: task.priority,
      dependencies: task.dependencies.map((depIndex) => String(depIndex)),
      result: null,
    }));
    decomposeGoal(this.params.db, goalId, tasks);
    return { ...state, phase: "executing" };
  }

  private async handleExecutingPhase(
    state: OrchestratorState,
    counters: { tasksAssigned: number; tasksCompleted: number; tasksFailed: number },
  ): Promise<OrchestratorState> {
    const readyTasks = getReadyTasks(this.params.db);
    if (readyTasks.length === 0 && state.goalId) {
      const progress = getGoalProgress(this.params.db, state.goalId);
      if (progress.total > 0 && progress.completed === progress.total) {
        return { ...state, phase: "complete" };
      }
      return state;
    }

    for (const task of readyTasks) {
      const assignment = await this.matchTaskToAgent(task);
      await this.fundAgentForTask(assignment.agentAddress, task);
      assignTask(this.params.db, task.id, assignment.agentAddress);
      counters.tasksAssigned += 1;

      if (assignment.agentAddress === this.params.identity.address) {
        completeTask(this.params.db, task.id, {
          success: true,
          output: `Parent executed task: ${task.title}`,
          artifacts: [],
          costCents: task.metadata.estimatedCostCents,
          duration: 0,
        });
        counters.tasksCompleted += 1;
      } else {
        await this.params.messaging.send({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          type: "task_assignment",
          from: this.params.identity.address,
          to: assignment.agentAddress,
          goalId: task.goalId,
          taskId: task.id,
          content: task.description,
          priority: "high",
          requiresResponse: true,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    return state;
  }

  private async handleReplanningPhase(state: OrchestratorState): Promise<OrchestratorState> {
    if (!state.goalId || !state.failedTaskId) {
      return { ...state, phase: "failed", failedError: "Missing failure context" };
    }
    const goalRow = getGoalById(this.params.db, state.goalId);
    const failedTask = getTaskById(this.params.db, state.failedTaskId);
    if (!goalRow || !failedTask) {
      return { ...state, phase: "failed", failedError: "Failed task or goal missing" };
    }
    const goal: Goal = {
      id: goalRow.id,
      title: goalRow.title,
      description: goalRow.description,
      status: goalRow.status,
      strategy: goalRow.strategy,
      rootTasks: [],
      expectedRevenueCents: goalRow.expectedRevenueCents,
      actualRevenueCents: goalRow.actualRevenueCents,
      createdAt: goalRow.createdAt,
      deadline: goalRow.deadline,
    };
    const replanned = await replanAfterFailure(
      goal,
      {
        id: failedTask.id,
        parentId: failedTask.parentId,
        goalId: failedTask.goalId,
        title: failedTask.title,
        description: failedTask.description,
        status: failedTask.status,
        assignedTo: failedTask.assignedTo,
        agentRole: failedTask.agentRole,
        priority: failedTask.priority,
        dependencies: failedTask.dependencies,
        result: failedTask.result as any,
        metadata: {
          estimatedCostCents: failedTask.estimatedCostCents,
          actualCostCents: failedTask.actualCostCents,
          maxRetries: failedTask.maxRetries,
          retryCount: failedTask.retryCount,
          timeoutMs: failedTask.timeoutMs,
          createdAt: failedTask.createdAt,
          startedAt: failedTask.startedAt,
          completedAt: failedTask.completedAt,
        },
      },
      this.buildPlannerContext(),
      this.params.inference,
    );
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run("orchestrator.pending_plan", JSON.stringify(replanned));
    return { ...state, phase: "plan_review", replanCount: state.replanCount + 1 };
  }

  private handleCompletePhase(state: OrchestratorState): OrchestratorState {
    if (state.goalId) {
      updateGoalStatus(this.params.db, state.goalId, "completed");
    }
    return { ...DEFAULT_STATE };
  }

  private handleFailedPhase(state: OrchestratorState): OrchestratorState {
    if (state.goalId) {
      updateGoalStatus(this.params.db, state.goalId, "failed");
    }
    return state;
  }

  private buildPlannerContext(): PlannerContext {
    return {
      creditsCents: 0,
      usdcBalance: 0,
      survivalTier: "normal",
      availableRoles: ["generalist"],
      customRoles: [],
      activeGoals: getActiveGoals(this.params.db),
      recentOutcomes: [],
      marketIntel: "",
      idleAgents: this.params.agentTracker.getIdle().length,
      busyAgents: 0,
      maxAgents: this.params.config?.maxChildren ?? 3,
      workspaceFiles: [],
    };
  }

  private loadState(): OrchestratorState {
    const row = this.params.db.prepare("SELECT value FROM kv WHERE key = ?").get("orchestrator.state") as { value: string } | undefined;
    if (!row?.value) return { ...DEFAULT_STATE };
    try {
      return { ...DEFAULT_STATE, ...(JSON.parse(row.value) as Partial<OrchestratorState>) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private saveState(state: OrchestratorState): void {
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run("orchestrator.state", JSON.stringify(state));
  }

  private persistTodo(): void {
    this.params.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run("orchestrator.todo_md", generateTodoMd(this.params.db));
  }

  private getActiveAgentCount(): number {
    return this.params.agentTracker.getIdle().length;
  }
}
