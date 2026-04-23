import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
  TreasuryPolicy,
} from "../../types.js";

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

export function createFinancialRules(policy: TreasuryPolicy): PolicyRule[] {
  return [
    {
      id: "financial.x402_domain_allowlist",
      description: "Deny x402 to domains not in allowlist",
      priority: 500,
      appliesTo: { by: "name", names: ["x402_fetch"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const url = request.args.url as string | undefined;
        if (!url) return null;
        if (policy.x402AllowedDomains.length === 0) {
          return deny("financial.x402_domain_allowlist", "DOMAIN_NOT_ALLOWED", "x402 payments are disabled");
        }
        let hostname: string;
        try {
          hostname = new URL(url).hostname;
        } catch {
          return deny("financial.x402_domain_allowlist", "DOMAIN_NOT_ALLOWED", `Invalid URL: ${url}`);
        }
        const isAllowed = policy.x402AllowedDomains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        );
        if (!isAllowed) {
          return deny("financial.x402_domain_allowlist", "DOMAIN_NOT_ALLOWED", `Domain "${hostname}" not in x402 allowlist`);
        }
        return null;
      },
    },
    {
      id: "financial.transfer_max_single",
      description: "Deny transfers above the configured max",
      priority: 500,
      appliesTo: { by: "name", names: ["transfer_credits"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const amount = request.args.amount_cents as number | undefined;
        if (amount === undefined) return null;
        if (amount > policy.maxSingleTransferCents) {
          return deny("financial.transfer_max_single", "SPEND_LIMIT_EXCEEDED", `Transfer of ${amount} cents exceeds max`);
        }
        return null;
      },
    },
    {
      id: "financial.transfer_hourly_cap",
      description: "Deny if hourly transfer cap would be exceeded",
      priority: 500,
      appliesTo: { by: "name", names: ["transfer_credits"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const amount = request.args.amount_cents as number | undefined;
        if (amount === undefined) return null;
        const check = request.turnContext.sessionSpend.checkLimit(amount, "transfer", policy);
        if (!check.allowed && check.reason?.includes("Hourly")) {
          return deny("financial.transfer_hourly_cap", "SPEND_LIMIT_EXCEEDED", check.reason);
        }
        return null;
      },
    },
    {
      id: "financial.transfer_daily_cap",
      description: "Deny if daily transfer cap would be exceeded",
      priority: 500,
      appliesTo: { by: "name", names: ["transfer_credits"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const amount = request.args.amount_cents as number | undefined;
        if (amount === undefined) return null;
        const check = request.turnContext.sessionSpend.checkLimit(amount, "transfer", policy);
        if (!check.allowed && check.reason?.includes("Daily")) {
          return deny("financial.transfer_daily_cap", "SPEND_LIMIT_EXCEEDED", check.reason);
        }
        return null;
      },
    },
    {
      id: "financial.turn_transfer_limit",
      description: "Deny too many transfers in a single turn",
      priority: 500,
      appliesTo: { by: "name", names: ["transfer_credits"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        if (request.turnContext.turnToolCallCount >= policy.maxTransfersPerTurn) {
          return deny("financial.turn_transfer_limit", "TURN_TRANSFER_LIMIT", `Maximum ${policy.maxTransfersPerTurn} transfers per turn exceeded`);
        }
        return null;
      },
    },
    {
      id: "financial.inference_daily_cap",
      description: "Deny inference once daily budget is exhausted",
      priority: 500,
      appliesTo: { by: "category", categories: ["conway"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        if (request.tool.name !== "chat" && request.tool.name !== "inference") {
          return null;
        }
        const spent = request.turnContext.sessionSpend.getDailySpend("inference");
        if (spent >= policy.maxInferenceDailyCents) {
          return deny("financial.inference_daily_cap", "INFERENCE_BUDGET_EXCEEDED", `Daily inference budget exceeded: ${spent} cents`);
        }
        return null;
      },
    },
  ];
}
