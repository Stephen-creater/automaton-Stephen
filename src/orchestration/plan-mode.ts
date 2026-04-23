import type { PlannerOutput } from "./planner.js";

export type ExecutionPhase =
  | "idle"
  | "classifying"
  | "planning"
  | "plan_review"
  | "executing"
  | "replanning"
  | "complete"
  | "failed";

export interface ExecutionState {
  phase: ExecutionPhase;
  goalId: string;
  planId: string | null;
  planVersion: number;
  planFilePath: string | null;
  spawnedAgentIds: string[];
  replansRemaining: number;
  phaseEnteredAt: string;
}

export type PlanApprovalMode = "auto" | "supervised" | "consensus";

export interface PlanApprovalConfig {
  mode: PlanApprovalMode;
  autoBudgetThreshold: number;
  consensusCriticRole: string;
  reviewTimeoutMs: number;
}

const PLAN_MODE_STATE_KEY = "plan_mode.state";
const DEFAULT_REPLANS_REMAINING = 3;

export class PlanModeController {
  constructor(private readonly db: import("better-sqlite3").Database) {}

  getState(): ExecutionState {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(PLAN_MODE_STATE_KEY) as { value: string } | undefined;
    if (!row?.value) {
      return defaultExecutionState();
    }
    try {
      return { ...defaultExecutionState(), ...(JSON.parse(row.value) as Partial<ExecutionState>) };
    } catch {
      return defaultExecutionState();
    }
  }

  setState(state: Partial<ExecutionState>): void {
    const merged = { ...this.getState(), ...state };
    this.db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(PLAN_MODE_STATE_KEY, JSON.stringify(merged));
  }

  transition(from: ExecutionPhase, to: ExecutionPhase, _reason: string): void {
    const current = this.getState();
    if (current.phase !== from) {
      throw new Error(`Invalid transition precondition: ${current.phase} !== ${from}`);
    }
    this.setState({
      phase: to,
      phaseEnteredAt: new Date().toISOString(),
    });
  }

  canSpawnAgents(): boolean {
    const state = this.getState();
    return state.phase === "executing";
  }
}

export async function reviewPlan(
  plan: PlannerOutput,
  config: PlanApprovalConfig,
): Promise<{ approved: boolean; feedback?: string }> {
  if (config.mode === "auto") {
    return { approved: true, feedback: `Auto-approved plan cost ${plan.estimatedTotalCostCents}` };
  }
  if (config.mode === "supervised") {
    throw new Error("awaiting human approval");
  }
  return { approved: true, feedback: "Consensus mode simplified to auto-approve in this stage." };
}

function defaultExecutionState(): ExecutionState {
  return {
    phase: "idle",
    goalId: "",
    planId: null,
    planVersion: 0,
    planFilePath: null,
    spawnedAgentIds: [],
    replansRemaining: DEFAULT_REPLANS_REMAINING,
    phaseEnteredAt: new Date().toISOString(),
  };
}
