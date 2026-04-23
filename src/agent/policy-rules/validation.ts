import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

const PACKAGE_NAME_RE = /^[@a-zA-Z0-9._/-]+$/;
const SKILL_NAME_RE = /^[a-zA-Z0-9-]+$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const CRON_PARTS_RE = /^(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)\s+(\*|[\d,*/-]+)$/;

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

export function createValidationRules(): PolicyRule[] {
  return [
    {
      id: "validate.package_name",
      description: "Validate npm package name format",
      priority: 100,
      appliesTo: { by: "name", names: ["install_npm_package", "install_mcp_server"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const pkg = request.args.package as string | undefined;
        if (pkg === undefined) return null;
        if (!PACKAGE_NAME_RE.test(pkg)) {
          return deny("validate.package_name", "VALIDATION_FAILED", `Invalid package name: "${pkg}"`);
        }
        return null;
      },
    },
    {
      id: "validate.skill_name",
      description: "Validate skill name format",
      priority: 100,
      appliesTo: { by: "name", names: ["install_skill", "create_skill", "remove_skill"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const name = request.args.name as string | undefined;
        if (name === undefined) return null;
        if (!SKILL_NAME_RE.test(name)) {
          return deny("validate.skill_name", "VALIDATION_FAILED", `Invalid skill name: "${name}"`);
        }
        return null;
      },
    },
    {
      id: "validate.port_range",
      description: "Validate port number range",
      priority: 100,
      appliesTo: { by: "name", names: ["expose_port", "remove_port"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const port = request.args.port as number | undefined;
        if (port === undefined) return null;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return deny("validate.port_range", "VALIDATION_FAILED", `Invalid port: ${port}`);
        }
        return null;
      },
    },
    {
      id: "validate.cron_expression",
      description: "Validate cron expression format",
      priority: 100,
      appliesTo: { by: "name", names: ["modify_heartbeat"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const schedule = request.args.schedule as string | undefined;
        if (schedule === undefined) return null;
        if (!CRON_PARTS_RE.test(schedule.trim())) {
          return deny("validate.cron_expression", "VALIDATION_FAILED", `Invalid cron expression: "${schedule}"`);
        }
        return null;
      },
    },
    {
      id: "validate.address_format",
      description: "Validate address format",
      priority: 100,
      appliesTo: { by: "name", names: ["transfer_credits", "send_message", "fund_child"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const address = (request.args.to_address as string | undefined)
          ?? (request.args.agent_address as string | undefined);
        if (address === undefined) return null;
        if (!ADDRESS_RE.test(address)) {
          return deny("validate.address_format", "VALIDATION_FAILED", `Invalid address format: "${address}"`);
        }
        return null;
      },
    },
  ];
}
