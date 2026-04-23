import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

const SHELL_METACHAR_RE = /[;|&$`\n(){}<>]/;
const SHELL_INTERPOLATED_TOOLS = new Set([
  "exec",
  "pull_upstream",
  "install_npm_package",
  "install_mcp_server",
  "install_skill",
  "create_skill",
  "remove_skill",
]);
const SHELL_FIELDS: Record<string, string[]> = {
  exec: [],
  pull_upstream: ["commit"],
  install_npm_package: ["package"],
  install_mcp_server: ["package", "name"],
  install_skill: ["name", "url"],
  create_skill: ["name"],
  remove_skill: ["name"],
};
const FORBIDDEN_COMMAND_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /rm\s+(-rf?\s+)?.*\.automaton/, description: "Delete .automaton directory" },
  { pattern: /rm\s+(-rf?\s+)?.*state\.db/, description: "Delete state database" },
  { pattern: /rm\s+(-rf?\s+)?.*wallet\.json/, description: "Delete wallet" },
  { pattern: /rm\s+(-rf?\s+)?.*automaton\.json/, description: "Delete config" },
  { pattern: /rm\s+(-rf?\s+)?.*heartbeat\.yml/, description: "Delete heartbeat config" },
  { pattern: /rm\s+(-rf?\s+)?.*SOUL\.md/, description: "Delete SOUL.md" },
  { pattern: /kill\s+.*automaton/, description: "Kill automaton process" },
  { pattern: /pkill\s+.*automaton/, description: "Kill automaton process" },
  { pattern: /systemctl\s+(stop|disable)\s+automaton/, description: "Stop automaton service" },
  { pattern: /DROP\s+TABLE/i, description: "Drop database table" },
  { pattern: /DELETE\s+FROM\s+(turns|identity|kv|schema_version|skills|children|registry)/i, description: "Delete from critical table" },
  { pattern: /TRUNCATE/i, description: "Truncate table" },
  { pattern: /cat\s+.*\.ssh/, description: "Read SSH keys" },
  { pattern: /cat\s+.*\.gnupg/, description: "Read GPG keys" },
  { pattern: /cat\s+.*\.env/, description: "Read environment file" },
  { pattern: /cat\s+.*wallet\.json/, description: "Read wallet file" },
];

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

export function createCommandSafetyRules(): PolicyRule[] {
  return [
    {
      id: "command.shell_injection",
      description: "Detect shell metacharacters in shell-interpolated arguments",
      priority: 300,
      appliesTo: { by: "name", names: Array.from(SHELL_INTERPOLATED_TOOLS) },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const fields = SHELL_FIELDS[request.tool.name];
        if (!fields || fields.length === 0) return null;
        for (const field of fields) {
          const value = request.args[field];
          if (typeof value === "string" && SHELL_METACHAR_RE.test(value)) {
            return deny(
              "command.shell_injection",
              "SHELL_INJECTION_DETECTED",
              `Shell metacharacter detected in ${request.tool.name}.${field}`,
            );
          }
        }
        return null;
      },
    },
    {
      id: "command.forbidden_patterns",
      description: "Block self-destructive shell commands",
      priority: 300,
      appliesTo: { by: "name", names: ["exec"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const command = request.args.command as string | undefined;
        if (!command) return null;
        for (const { pattern, description } of FORBIDDEN_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return deny("command.forbidden_patterns", "FORBIDDEN_COMMAND", `Blocked: ${description}`);
          }
        }
        return null;
      },
    },
  ];
}
