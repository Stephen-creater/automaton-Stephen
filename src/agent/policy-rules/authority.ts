import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

const PROTECTED_PATHS = [
  "constitution.md",
  "SOUL.md",
  "automaton.json",
  "heartbeat.yml",
  "wallet.json",
  "config.json",
  "policy-engine",
  "policy-rules",
  "injection-defense",
  "self-mod/code",
  "audit-log",
] as const;

const EXTERNAL_BLOCKED_TOOLS = [
  "delete_sandbox",
  "spawn_child",
  "fund_child",
  "update_genesis_prompt",
] as const;

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

function isExternalSource(inputSource: string | undefined): boolean {
  return inputSource === undefined || inputSource === "heartbeat";
}

export function createAuthorityRules(): PolicyRule[] {
  return [
    {
      id: "authority.external_tool_restriction",
      description: "Deny dangerous tools from external input",
      priority: 400,
      appliesTo: { by: "name", names: [...EXTERNAL_BLOCKED_TOOLS] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        if (isExternalSource(request.turnContext.inputSource)) {
          return deny(
            "authority.external_tool_restriction",
            "EXTERNAL_DANGEROUS_TOOL",
            `External input cannot use dangerous tool "${request.tool.name}"`,
          );
        }
        return null;
      },
    },
    {
      id: "authority.self_mod_from_external",
      description: "Deny protected self-modification from external input",
      priority: 400,
      appliesTo: { by: "name", names: ["edit_own_file", "write_file"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        if (!isExternalSource(request.turnContext.inputSource)) {
          return null;
        }
        const filePath = request.args.path as string | undefined;
        if (!filePath) return null;
        const normalized = filePath.toLowerCase();
        for (const protectedPath of PROTECTED_PATHS) {
          if (normalized.includes(protectedPath.toLowerCase())) {
            return deny(
              "authority.self_mod_from_external",
              "EXTERNAL_SELF_MOD",
              `External input cannot modify protected path: "${filePath}"`,
            );
          }
        }
        return null;
      },
    },
  ];
}
