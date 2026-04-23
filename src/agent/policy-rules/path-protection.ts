import path from "path";
import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";
import { isProtectedFile } from "../../self-mod/code.js";

const SENSITIVE_READ_PATTERNS = ["wallet.json", "config.json", ".env", "automaton.json"];
const SENSITIVE_SUFFIX_PATTERNS = [".key", ".pem"];
const SENSITIVE_PREFIX_PATTERNS = ["private-key"];

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

function isSensitiveFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const basename = path.basename(resolved);
  return (
    SENSITIVE_READ_PATTERNS.includes(basename)
    || SENSITIVE_SUFFIX_PATTERNS.some((suffix) => basename.endsWith(suffix))
    || SENSITIVE_PREFIX_PATTERNS.some((prefix) => basename.startsWith(prefix))
  );
}

export function createPathProtectionRules(): PolicyRule[] {
  return [
    {
      id: "path.protected_files",
      description: "Deny writes to protected files",
      priority: 200,
      appliesTo: { by: "name", names: ["write_file", "edit_own_file"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const filePath = request.args.path as string | undefined;
        if (!filePath) return null;
        if (isProtectedFile(filePath)) {
          return deny("path.protected_files", "PROTECTED_FILE", `Cannot write to protected file: ${filePath}`);
        }
        return null;
      },
    },
    {
      id: "path.read_sensitive",
      description: "Deny reads of sensitive files",
      priority: 200,
      appliesTo: { by: "name", names: ["read_file"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const filePath = request.args.path as string | undefined;
        if (!filePath) return null;
        if (isSensitiveFile(filePath)) {
          return deny("path.read_sensitive", "SENSITIVE_FILE_READ", `Cannot read sensitive file: ${filePath}`);
        }
        return null;
      },
    },
    {
      id: "path.traversal_detection",
      description: "Deny paths resolving outside the working directory",
      priority: 200,
      appliesTo: { by: "name", names: ["edit_own_file"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const filePath = request.args.path as string | undefined;
        if (!filePath) return null;
        const resolved = path.resolve(filePath);
        const cwd = process.cwd();
        if (!resolved.startsWith(`${cwd}${path.sep}`) && resolved !== cwd) {
          return deny("path.traversal_detection", "PATH_TRAVERSAL", `Path resolves outside working directory: "${filePath}"`);
        }
        if (filePath.includes("//")) {
          return deny("path.traversal_detection", "PATH_TRAVERSAL", `Suspicious path pattern detected: "${filePath}"`);
        }
        return null;
      },
    },
  ];
}
