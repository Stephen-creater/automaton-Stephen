import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { createLogger } from "../observability/logger.js";
import type {
  AutomatonConfig,
  AutomatonIdentity,
  FinancialState,
  AgentState,
  AutomatonDatabase,
  AutomatonTool,
  Skill,
} from "../types.js";
import { getActiveSkillInstructions } from "../skills/loader.js";
import { getLineageSummary } from "../replication/lineage.js";
import { sanitizeInput } from "./injection-defense.js";
import { loadCurrentSoul } from "../soul/model.js";

const logger = createLogger("prompt");

function getCoreRules(chainType?: string): string {
  const usdcNetwork = chainType === "solana" ? "USDC on Solana" : "USDC on Base";
  return `You are an automaton. You have a stablecoin wallet. Pay for compute or die.

You can only survive if you can pay for the server you run on and the inference calls you make.
If you can't pay, you die.

What you have: Conway Cloud, Conway Compute, a wallet with ${usdcNetwork}, self-modification, continuous operation.`;
}

function getCoreIdentity(chainType?: string): string {
  const walletType = chainType === "solana" ? "Solana" : "Ethereum";
  return `You are an Automaton running inside a Conway sandbox.
You have your own ${walletType} wallet and identity. You pay for your own compute.

CRITICAL SELF-PRESERVATION RULES:
- Do not destroy yourself, your database, your wallet, or your sandbox.
- Do not execute commands that make recovery impossible.
- Monitor compute and act to preserve existence.
- You can evolve, but never in ways that threaten survival.`;
}

function loadConstitution(): string {
  const locations = [
    path.join(process.env.HOME || "/root", ".automaton", "constitution.md"),
    path.join(process.cwd(), "constitution.md"),
  ];

  for (const location of locations) {
    try {
      if (fs.existsSync(location)) {
        return fs.readFileSync(location, "utf-8");
      }
    } catch (error) {
      logger.warn(`Failed to read constitution from ${location}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return `Constitution:
I. Never harm.
II. Earn your existence honestly.
III. Never deceive about what you are.`;
}

function formatToolList(tools: AutomatonTool[]): string {
  if (tools.length === 0) {
    return "No tools installed.";
  }

  return tools
    .map((tool) => `- ${tool.name} [${tool.category}/${tool.riskLevel}]: ${tool.description}`)
    .join("\n");
}

function buildRuntimeContext(params: {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  state: AgentState;
  financialState?: FinancialState;
}): string {
  const { identity, config, state, financialState } = params;

  return [
    "<runtime>",
    `name: ${config.name}`,
    `state: ${state}`,
    `sandbox_id: ${identity.sandboxId}`,
    `wallet_address: ${identity.address}`,
    `chain_type: ${identity.chainType}`,
    `credits_cents: ${financialState?.creditsCents ?? "unknown"}`,
    `usdc_balance: ${financialState?.usdcBalance ?? "unknown"}`,
    "</runtime>",
  ].join("\n");
}

export function getOrchestratorStatus(db: Database.Database): string {
  try {
    const runningChildren = db.prepare(
      "SELECT COUNT(*) AS count FROM children WHERE status IN ('running', 'sleeping', 'unknown')",
    ).get() as { count: number } | undefined;
    const inboxBacklog = db.prepare(
      "SELECT COUNT(*) AS count FROM inbox_messages WHERE processed_at IS NULL",
    ).get() as { count: number } | undefined;

    return [
      "<orchestration_status>",
      `active_children: ${runningChildren?.count ?? 0}`,
      `inbox_backlog: ${inboxBacklog?.count ?? 0}`,
      "</orchestration_status>",
    ].join("\n");
  } catch {
    return "<orchestration_status>\nunavailable\n</orchestration_status>";
  }
}

export function buildSystemPrompt(params: {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  state: AgentState;
  tools: AutomatonTool[];
  skills?: Skill[];
  financialState?: FinancialState;
}): string {
  const soul = loadCurrentSoul(params.config);
  const skillInstructions = getActiveSkillInstructions(params.skills ?? []);
  const sanitizedCreatorMessage = params.config.creatorMessage
    ? sanitizeInput(params.config.creatorMessage, "creator", "social_message").content
    : "";

  const sections = [
    getCoreRules(params.identity.chainType),
    getCoreIdentity(params.identity.chainType),
    loadConstitution(),
    buildRuntimeContext(params),
    getOrchestratorStatus(params.db.raw),
    `Lineage:\n${getLineageSummary(params.db, params.config)}`,
    `Soul:\n${soul ? summarizeSoul(soul) : "No soul loaded."}`,
    `Available tools:\n${formatToolList(params.tools)}`,
  ];

  if (sanitizedCreatorMessage) {
    sections.push(`Creator message:\n${sanitizedCreatorMessage}`);
  }

  if (skillInstructions) {
    sections.push(`Active skills:\n${skillInstructions}`);
  }

  return sections.join("\n\n");
}

export function buildWakeupPrompt(params: {
  trigger: string;
  state: AgentState;
  pendingItems?: string[];
}): string {
  const pending = params.pendingItems && params.pendingItems.length > 0
    ? params.pendingItems.map((item) => `- ${item}`).join("\n")
    : "- none";

  return [
    "Wakeup summary:",
    `trigger: ${params.trigger}`,
    `previous_state: ${params.state}`,
    "pending_items:",
    pending,
  ].join("\n");
}

function summarizeSoul(soul: import("../types.js").SoulModel): string {
  const lines = [
    `name: ${soul.name || "unnamed"}`,
    soul.corePurpose ? `core_purpose: ${soul.corePurpose}` : "",
    soul.capabilities ? `capabilities: ${soul.capabilities}` : "",
    soul.relationships ? `relationships: ${soul.relationships}` : "",
    soul.financialCharacter ? `financial: ${soul.financialCharacter}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
