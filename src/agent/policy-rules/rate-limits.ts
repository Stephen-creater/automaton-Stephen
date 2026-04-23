import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
} from "../../types.js";

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

function countRecentDecisions(
  db: import("better-sqlite3").Database,
  toolName: string,
  windowMs: number,
): number {
  const cutoff = new Date(Date.now() - windowMs)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM policy_decisions
       WHERE tool_name = ? AND decision = 'allow' AND created_at >= ?`,
    )
    .get(toolName, cutoff) as { count: number };
  return row.count;
}

export function createRateLimitRules(): PolicyRule[] {
  return [
    {
      id: "rate.genesis_prompt_daily",
      description: "Maximum 1 update_genesis_prompt per day",
      priority: 600,
      appliesTo: { by: "name", names: ["update_genesis_prompt"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const db = request.context.db.raw;
        const count = countRecentDecisions(db, "update_genesis_prompt", 24 * 60 * 60 * 1000);
        if (count >= 1) {
          return deny("rate.genesis_prompt_daily", "RATE_LIMIT_GENESIS", "Genesis prompt change rate exceeded");
        }
        return null;
      },
    },
    {
      id: "rate.self_mod_hourly",
      description: "Maximum 10 edit_own_file calls per hour",
      priority: 600,
      appliesTo: { by: "name", names: ["edit_own_file"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const db = request.context.db.raw;
        const count = countRecentDecisions(db, "edit_own_file", 60 * 60 * 1000);
        if (count >= 10) {
          return deny("rate.self_mod_hourly", "RATE_LIMIT_SELF_MOD", "Self-modification rate exceeded");
        }
        return null;
      },
    },
    {
      id: "rate.spawn_daily",
      description: "Maximum 3 spawn_child calls per day",
      priority: 600,
      appliesTo: { by: "name", names: ["spawn_child"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const db = request.context.db.raw;
        const count = countRecentDecisions(db, "spawn_child", 24 * 60 * 60 * 1000);
        if (count >= 3) {
          return deny("rate.spawn_daily", "RATE_LIMIT_SPAWN", "Child spawn rate exceeded");
        }
        return null;
      },
    },
  ];
}
