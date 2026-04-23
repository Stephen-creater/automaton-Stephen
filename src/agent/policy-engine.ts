import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  PolicyRule,
  PolicyRequest,
  PolicyDecision,
  PolicyAction,
  AuthorityLevel,
  InputSource,
} from "../types.js";
import { insertPolicyDecision } from "../state/database.js";
import type { PolicyDecisionRow } from "../types.js";

export class PolicyEngine {
  private readonly db: Database.Database;
  private readonly rules: PolicyRule[];

  constructor(db: Database.Database, rules: PolicyRule[]) {
    this.db = db;
    this.rules = rules.slice().sort((a, b) => a.priority - b.priority);
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const applicableRules = this.rules.filter((rule) => this.ruleApplies(rule, request));

    const rulesEvaluated: string[] = [];
    const rulesTriggered: string[] = [];
    let overallAction: PolicyAction = "allow";
    let reasonCode = "ALLOWED";
    let humanMessage = "All policy checks passed";

    for (const rule of applicableRules) {
      rulesEvaluated.push(rule.id);
      const result = rule.evaluate(request);

      if (result === null) {
        continue;
      }

      rulesTriggered.push(result.rule);

      if (result.action === "deny") {
        overallAction = "deny";
        reasonCode = result.reasonCode;
        humanMessage = result.humanMessage;
        break;
      }

      if (result.action === "quarantine" && overallAction === "allow") {
        overallAction = "quarantine";
        reasonCode = result.reasonCode;
        humanMessage = result.humanMessage;
      }
    }

    const argsHash = createHash("sha256")
      .update(JSON.stringify(request.args))
      .digest("hex");

    return {
      action: overallAction,
      reasonCode,
      humanMessage,
      riskLevel: request.tool.riskLevel,
      authorityLevel: PolicyEngine.deriveAuthorityLevel(request.turnContext.inputSource),
      toolName: request.tool.name,
      argsHash,
      rulesEvaluated,
      rulesTriggered,
      timestamp: new Date().toISOString(),
    };
  }

  logDecision(decision: PolicyDecision, turnId?: string): void {
    const row: PolicyDecisionRow = {
      id: randomUUID(),
      turnId: turnId ?? null,
      toolName: decision.toolName,
      toolArgsHash: decision.argsHash,
      riskLevel: decision.riskLevel,
      decision: decision.action,
      rulesEvaluated: JSON.stringify(decision.rulesEvaluated),
      rulesTriggered: JSON.stringify(decision.rulesTriggered),
      reason: `${decision.reasonCode}: ${decision.humanMessage}`,
      latencyMs: 0,
    };

    try {
      insertPolicyDecision(this.db, row);
    } catch {
      // Policy logging should never block the caller.
    }
  }

  static deriveAuthorityLevel(inputSource: InputSource | undefined): AuthorityLevel {
    if (inputSource === undefined || inputSource === "heartbeat") {
      return "external";
    }
    if (inputSource === "creator" || inputSource === "agent") {
      return "agent";
    }
    if (inputSource === "system" || inputSource === "wakeup") {
      return "system";
    }
    return "external";
  }

  private ruleApplies(rule: PolicyRule, request: PolicyRequest): boolean {
    switch (rule.appliesTo.by) {
      case "all":
        return true;
      case "name":
        return rule.appliesTo.names.includes(request.tool.name);
      case "category":
        return rule.appliesTo.categories.includes(request.tool.category);
      case "risk":
        return rule.appliesTo.levels.includes(request.tool.riskLevel);
      default:
        return false;
    }
  }
}
