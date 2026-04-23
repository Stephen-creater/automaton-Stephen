import type {
  AutomatonDatabase,
  ModificationEntry,
  ModificationType,
} from "../types.js";
import { randomUUID } from "node:crypto";

export function logModification(
  db: AutomatonDatabase,
  type: ModificationType,
  description: string,
  options?: {
    filePath?: string;
    diff?: string;
    reversible?: boolean;
  },
): ModificationEntry {
  const entry: ModificationEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    description,
    filePath: options?.filePath,
    diff: options?.diff,
    reversible: options?.reversible ?? true,
  };

  db.insertModification(entry);
  return entry;
}

export function getRecentModifications(
  db: AutomatonDatabase,
  limit: number = 20,
): ModificationEntry[] {
  return db.getRecentModifications(limit);
}

export function generateAuditReport(
  db: AutomatonDatabase,
): string {
  const modifications = db.getRecentModifications(100);

  if (modifications.length === 0) {
    return "No self-modifications recorded.";
  }

  const lines = [
    "=== SELF-MODIFICATION AUDIT LOG ===",
    `Total modifications: ${modifications.length}`,
    "",
  ];

  for (const mod of modifications) {
    lines.push(
      `[${mod.timestamp}] ${mod.type}: ${mod.description}${mod.filePath ? ` (${mod.filePath})` : ""}`,
    );
  }

  lines.push("=================================");
  return lines.join("\n");
}
