import fs from "fs";
import path from "path";
import type {
  ConwayClient,
  AutomatonDatabase,
} from "../types.js";
import { logModification } from "./audit-log.js";

const PROTECTED_FILES: readonly string[] = Object.freeze([
  "wallet.json",
  "config.json",
  "state.db",
  "state.db-wal",
  "state.db-shm",
  "constitution.md",
  "injection-defense.ts",
  "self-mod/code.ts",
  "self-mod/audit-log.ts",
  "self-mod/upstream.ts",
  "self-mod/tools-manager.ts",
  "agent/tools.ts",
  "agent/policy-engine.ts",
  "agent/policy-rules/index.ts",
  "skills/loader.ts",
  "automaton.json",
  "package.json",
  "SOUL.md",
]);

const BLOCKED_DIRECTORY_PATTERNS: readonly string[] = Object.freeze([
  ".ssh",
  ".gnupg",
  ".gpg",
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
const MAX_DIFF_SIZE = 10_000;

function resolveAndValidatePath(filePath: string): string | null {
  try {
    let resolved = filePath;
    if (resolved.startsWith("~")) {
      resolved = path.join(process.env.HOME || "/root", resolved.slice(1));
    }

    resolved = path.resolve(resolved);

    const baseDir = path.resolve(process.cwd());
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
      return null;
    }

    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      if (!realPath.startsWith(baseDir + path.sep) && realPath !== baseDir) {
        return null;
      }
      resolved = realPath;
    }

    return resolved;
  } catch {
    return null;
  }
}

export function isProtectedFile(filePath: string): boolean {
  const resolved = path.resolve(filePath);

  for (const pattern of PROTECTED_FILES) {
    const patternResolved = path.resolve(pattern);
    if (resolved === patternResolved) return true;
    if (resolved.endsWith(path.sep + pattern)) return true;
    if (pattern.includes("/") && resolved.endsWith(path.sep + pattern.replace(/\//g, path.sep))) return true;
  }

  for (const pattern of BLOCKED_DIRECTORY_PATTERNS) {
    if (
      resolved.includes(path.sep + pattern + path.sep) ||
      resolved.endsWith(path.sep + pattern) ||
      resolved === pattern
    ) {
      return true;
    }
    if (pattern.startsWith("/") && resolved.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}

function isRateLimited(db: AutomatonDatabase): boolean {
  const recentMods = db.getRecentModifications(MAX_MODIFICATIONS_PER_HOUR);
  if (recentMods.length < MAX_MODIFICATIONS_PER_HOUR) return false;

  const oldest = recentMods[0];
  if (!oldest) return false;

  const hourAgo = Date.now() - 60 * 60 * 1000;
  return new Date(oldest.timestamp).getTime() > hourAgo;
}

export function validateModification(
  db: AutomatonDatabase,
  filePath: string,
  contentLength: number,
): {
  allowed: boolean;
  reason?: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
} {
  const protectedFile = isProtectedFile(filePath);
  const resolvedPath = resolveAndValidatePath(filePath);
  const rateLimited = isRateLimited(db);
  const tooLarge = contentLength > MAX_MODIFICATION_SIZE;

  const checks = [
    {
      name: "protected_file",
      passed: !protectedFile,
      detail: protectedFile ? "target is protected" : "ok",
    },
    {
      name: "path_validation",
      passed: resolvedPath !== null,
      detail: resolvedPath ? "ok" : "invalid or suspicious path",
    },
    {
      name: "rate_limit",
      passed: !rateLimited,
      detail: rateLimited ? "too many modifications in last hour" : "ok",
    },
    {
      name: "size_limit",
      passed: !tooLarge,
      detail: tooLarge ? `content too large (${contentLength} > ${MAX_MODIFICATION_SIZE})` : "ok",
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

  let oldContent = "";
  try {
    if (fs.existsSync(resolvedPath)) {
      oldContent = fs.readFileSync(resolvedPath, "utf-8");
    }
  } catch {
    oldContent = "";
  }

  await conway.writeFile(resolvedPath, newContent);

  logModification(db, "code_edit", reason, {
    filePath: resolvedPath,
    diff: buildSimpleDiff(oldContent, newContent),
    reversible: true,
  });

  return { success: true };
}

function buildSimpleDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) {
    return "[no changes]";
  }

  const diff = [
    "--- before",
    oldContent.slice(0, MAX_DIFF_SIZE / 2),
    "+++ after",
    newContent.slice(0, MAX_DIFF_SIZE / 2),
  ].join("\n");

  return diff.length > MAX_DIFF_SIZE
    ? `${diff.slice(0, MAX_DIFF_SIZE)}\n...[truncated]`
    : diff;
}
