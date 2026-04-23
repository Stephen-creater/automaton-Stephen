export type {
  WorkingMemoryType,
  WorkingMemoryEntry,
  TurnClassification,
  EpisodicMemoryEntry,
  SemanticCategory,
  SemanticMemoryEntry,
  ProceduralStep,
  ProceduralMemoryEntry,
  RelationshipMemoryEntry,
  SessionSummaryEntry,
  MemoryRetrievalResult,
  MemoryBudget,
} from "../types.js";

export { DEFAULT_MEMORY_BUDGET } from "../types.js";

import type { ToolCallResult } from "../types.js";

export interface MemoryIngestionConfig {
  maxWorkingMemoryEntries: number;
  episodicRetentionDays: number;
  semanticMaxEntries: number;
  enableAutoIngestion: boolean;
}

export const DEFAULT_INGESTION_CONFIG: MemoryIngestionConfig = {
  maxWorkingMemoryEntries: 20,
  episodicRetentionDays: 30,
  semanticMaxEntries: 500,
  enableAutoIngestion: true,
};

const STRATEGIC_TOOLS = new Set([
  "update_genesis_prompt",
  "edit_own_file",
  "modify_heartbeat",
  "spawn_child",
  "update_soul",
]);

const PRODUCTIVE_TOOLS = new Set([
  "exec",
  "write_file",
  "install_npm_package",
  "create_sandbox",
  "expose_port",
  "register_domain",
  "install_skill",
]);

const COMMUNICATION_TOOLS = new Set([
  "send_message",
  "give_feedback",
]);

const MAINTENANCE_TOOLS = new Set([
  "check_credits",
  "check_usdc_balance",
  "list_sandboxes",
  "list_skills",
  "list_children",
  "list_models",
  "review_memory",
  "recall_facts",
  "recall_procedure",
  "search_domains",
]);

const ERROR_KEYWORDS = ["error", "failed", "exception", "blocked", "denied"];

export function classifyTurn(
  toolCalls: ToolCallResult[],
  thinking: string,
): import("../types.js").TurnClassification {
  if (toolCalls.some((toolCall) => toolCall.error)) {
    return "error";
  }

  const lowerThinking = thinking.toLowerCase();
  if (ERROR_KEYWORDS.some((keyword) => lowerThinking.includes(keyword)) && toolCalls.length === 0) {
    return "error";
  }

  const toolNames = new Set(toolCalls.map((toolCall) => toolCall.name));
  for (const name of toolNames) {
    if (STRATEGIC_TOOLS.has(name)) return "strategic";
  }
  for (const name of toolNames) {
    if (COMMUNICATION_TOOLS.has(name)) return "communication";
  }
  for (const name of toolNames) {
    if (PRODUCTIVE_TOOLS.has(name)) return "productive";
  }
  for (const name of toolNames) {
    if (MAINTENANCE_TOOLS.has(name)) return "maintenance";
  }

  if (toolCalls.length === 0 && thinking.length < 100) {
    return "idle";
  }

  return "maintenance";
}
