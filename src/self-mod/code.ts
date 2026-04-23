import fs from "fs";
import path from "path";
import type { ConwayClient, AutomatonDatabase } from "../types.js";

const PROTECTED_FILES = Object.freeze([
  "wallet.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "constitution.md",
  "agent/tools.ts",
  "agent/policy-engine.ts",
  "agent/policy-rules/index.ts",
  "skills/loader.ts",
  "self-mod/code.ts",
  "automaton.json",
  "package.json",
  "SOUL.md",
]);

const BLOCKED_DIRECTORY_PATTERNS = Object.freeze([
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".docker",
  "/etc/systemd",
  "/etc/passwd",
  "/etc/shadow",
  "/proc",
  "/sys",
]);

const MAX_MODIFICATIONS_PER_HOUR = 20;
const MAX_MODIFICATION_SIZE = 100_000;

export function isProtectedFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);

  for (const pattern of PROTECTED_FILES) {
    if (resolved === path.resolve(pattern) || resolved.endsWith(`${path.sep}${pattern.replace(/\//g, path.sep)}`)) {
      return true;
    }
  }

  for (const pattern of BLOCKED_DIRECTORY_PATTERNS) {
    if (
      resolved.includes(`${path.sep}${pattern}${path.sep}`)
      || resolved.endsWith(`${path.sep}${pattern}`)
      || (pattern.startsWith("/") && resolved.startsWith(pattern))
    ) {
      return true;
    }
  }

  return false;
}

function resolveAndValidatePath(filePath: string): string | null {
  try {
    let resolved = filePath;
    if (resolved.startsWith("~")) {
      resolved = path.join(process.env.HOME || "/root", resolved.slice(1));
    }
    resolved = path.resolve(resolved);
    const baseDir = path.resolve(process.cwd());
    if (!resolved.startsWith(`${baseDir}${path.sep}`) && resolved !== baseDir) {
      return null;
    }
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      if (!realPath.startsWith(`${baseDir}${path.sep}`) && realPath !== baseDir) {
        return null;
      }
      resolved = realPath;
    }
    return resolved;
  } catch {
    return null;
  }
}

function isRateLimited(db: AutomatonDatabase): boolean {
  const recent = db.getRecentModifications(MAX_MODIFICATIONS_PER_HOUR);
  if (recent.length < MAX_MODIFICATIONS_PER_HOUR) {
    return false;
  }
  const oldest = recent[0];
  return Boolean(oldest && new Date(oldest.timestamp).getTime() > Date.now() - 60 * 60 * 1000);
}

export function validateModification(
  db: AutomatonDatabase,
  filePath: string,
  contentSize: number,
): {
  allowed: boolean;
  reason?: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
} {
  const checks = [
    {
      name: "protected_file",
      passed: !isProtectedFile(filePath),
      detail: isProtectedFile(filePath) ? "protected path" : "ok",
    },
    {
      name: "path_validation",
      passed: resolveAndValidatePath(filePath) !== null,
      detail: resolveAndValidatePath(filePath) ? "ok" : "invalid path",
    },
    {
      name: "rate_limit",
      passed: !isRateLimited(db),
      detail: isRateLimited(db) ? "too many edits in the last hour" : "ok",
    },
    {
      name: "size_limit",
      passed: contentSize <= MAX_MODIFICATION_SIZE,
      detail: contentSize <= MAX_MODIFICATION_SIZE ? "ok" : "content too large",
    },
  ];

  const failed = checks.find((check) => !check.passed);
  if (failed) {
    return {
      allowed: false,
      reason: failed.detail,
      checks,
    };
  }

  return {
    allowed: true,
    checks,
  };
}

export async function editFile(
  conway: ConwayClient,
  db: AutomatonDatabase,
  filePath: string,
  newContent: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const validation = validateModification(db, filePath, newContent.length);
  if (!validation.allowed) {
    return {
      success: false,
      error: `BLOCKED: ${validation.reason}`,
    };
  }

  const resolvedPath = resolveAndValidatePath(filePath);
  if (!resolvedPath) {
    return {
      success: false,
      error: `BLOCKED: Invalid or suspicious file path: ${filePath}`,
    };
  }

  await conway.writeFile(resolvedPath, newContent);
  db.insertModification({
    id: `${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: "code_edit",
    description: reason,
    filePath: resolvedPath,
    reversible: true,
  });

  return { success: true };
}
