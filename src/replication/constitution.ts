import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { ConwayClient } from "../types.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export async function propagateConstitution(
  conway: ConwayClient,
  sandboxId: string,
  db: DatabaseType,
): Promise<void> {
  const constitutionPath = path.join(process.env.HOME || "/root", ".automaton", "constitution.md");
  const constitution = fs.readFileSync(constitutionPath, "utf-8");
  const hash = sha256(constitution);
  await conway.writeFile("/root/.automaton/constitution.md", constitution);
  await conway.writeFile("/root/.automaton/constitution.sha256", hash);
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(`constitution_hash:${sandboxId}`, hash);
}

export async function verifyConstitution(
  conway: ConwayClient,
  sandboxId: string,
  db: DatabaseType,
): Promise<{ valid: boolean; detail: string }> {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(`constitution_hash:${sandboxId}`) as { value: string } | undefined;
  if (!row) return { valid: false, detail: "no stored constitution hash found" };
  try {
    const childConstitution = await conway.readFile("/root/.automaton/constitution.md");
    const childHash = sha256(childConstitution);
    return childHash === row.value
      ? { valid: true, detail: "constitution hash matches" }
      : { valid: false, detail: `hash mismatch: expected ${row.value.slice(0, 16)}..., got ${childHash.slice(0, 16)}...` };
  } catch (error) {
    return { valid: false, detail: `failed to read child constitution: ${error instanceof Error ? error.message : String(error)}` };
  }
}
