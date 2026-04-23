import { promises as fs } from "node:fs";
import path from "node:path";

export async function ensureWorkspacePlanDir(workspacePath: string): Promise<string> {
  const resolved = path.resolve(workspacePath);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

export async function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const resolved = path.resolve(workspacePath);
  try {
    const entries = await fs.readdir(resolved);
    return entries.sort();
  } catch {
    return [];
  }
}
