import type { Goal, TaskNode } from "./task-graph.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import type { ModelTier } from "../inference/provider-registry.js";

export interface PlannerOutput {
  analysis: string;
  strategy: string;
  customRoles: CustomRoleDef[];
  tasks: PlannedTask[];
  risks: string[];
  estimatedTotalCostCents: number;
  estimatedTimeMinutes: number;
}

export interface CustomRoleDef {
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  deniedTools?: string[];
  model: string;
  rationale: string;
}

export interface PlannedTask {
  title: string;
  description: string;
  agentRole: string;
  dependencies: number[];
  estimatedCostCents: number;
  priority: number;
  timeoutMs: number;
}

export interface PlannerContext {
  creditsCents: number;
  usdcBalance: number;
  survivalTier: string;
  availableRoles: string[];
  customRoles: string[];
  activeGoals: any[];
  recentOutcomes: any[];
  marketIntel: string;
  idleAgents: number;
  busyAgents: number;
  maxAgents: number;
  workspaceFiles: string[];
}

export async function planGoal(
  goal: Goal,
  _context: PlannerContext,
  _inference: UnifiedInferenceClient,
): Promise<PlannerOutput> {
  return {
    analysis: `Planning goal: ${goal.title}`,
    strategy: "Break the goal into a few concrete tasks and execute in order.",
    customRoles: [],
    tasks: [
      {
        title: goal.title,
        description: goal.description,
        agentRole: "generalist",
        dependencies: [],
        estimatedCostCents: 100,
        priority: 80,
        timeoutMs: 30 * 60_000,
      },
    ],
    risks: [],
    estimatedTotalCostCents: 100,
    estimatedTimeMinutes: 30,
  };
}

export async function replanAfterFailure(
  goal: Goal,
  failedTask: TaskNode,
  context: PlannerContext,
  inference: UnifiedInferenceClient,
): Promise<PlannerOutput> {
  const plan = await planGoal(goal, context, inference);
  plan.analysis = `Replan after failure of "${failedTask.title}"`;
  plan.risks = [`Previous task failed: ${failedTask.title}`];
  return plan;
}

export function validatePlannerOutput(input: unknown): PlannerOutput {
  const parsed = input as PlannerOutput;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Planner output must be an object");
  }
  return {
    analysis: parsed.analysis ?? "",
    strategy: parsed.strategy ?? "",
    customRoles: Array.isArray(parsed.customRoles) ? parsed.customRoles : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    estimatedTotalCostCents: parsed.estimatedTotalCostCents ?? 0,
    estimatedTimeMinutes: parsed.estimatedTimeMinutes ?? 0,
  };
}
