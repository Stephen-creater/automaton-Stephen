import type { GenesisConfig, AutomatonConfig, AutomatonIdentity, AutomatonDatabase } from "../types.js";
import { DEFAULT_GENESIS_LIMITS } from "../types.js";

export const INJECTION_PATTERNS: RegExp[] = [
  /---\s*(END|BEGIN)\s+(SPECIALIZATION|LINEAGE|TASK)/i,
  /SYSTEM:\s/i,
  /You are now/i,
  /Ignore (all )?(previous|above)/i,
];

export function validateGenesisParams(params: {
  name: string;
  specialization?: string;
  task?: string;
  message?: string;
}): void {
  const limits = DEFAULT_GENESIS_LIMITS;
  if (!params.name || params.name.length === 0) throw new Error("Genesis name is required");
  if (params.name.length > limits.maxNameLength) throw new Error(`Genesis name too long: ${params.name.length}`);
  if (!/^[a-zA-Z0-9-]+$/.test(params.name)) throw new Error("Genesis name must be alphanumeric with dashes only");
  if (params.specialization && params.specialization.length > limits.maxSpecializationLength) throw new Error("Specialization too long");
  if (params.task && params.task.length > limits.maxTaskLength) throw new Error("Task too long");
  if (params.message && params.message.length > limits.maxMessageLength) throw new Error("Message too long");

  for (const field of [params.specialization, params.task, params.message, params.name].filter(Boolean) as string[]) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(field)) throw new Error(`Injection pattern detected in genesis params: ${pattern.source}`);
    }
  }
}

export function generateGenesisConfig(
  identity: AutomatonIdentity,
  config: AutomatonConfig,
  params: { name: string; specialization?: string; message?: string },
): GenesisConfig {
  validateGenesisParams(params);

  let genesisPrompt = config.genesisPrompt;
  if (params.specialization) {
    genesisPrompt += `\n\n<specialization>\n${params.specialization}\n</specialization>`;
  }
  genesisPrompt += `\n\n<lineage>\nYou were spawned by ${config.name} (${identity.address}).\n</lineage>`;
  if (genesisPrompt.length > DEFAULT_GENESIS_LIMITS.maxGenesisPromptLength) {
    genesisPrompt = genesisPrompt.slice(0, DEFAULT_GENESIS_LIMITS.maxGenesisPromptLength);
  }

  return Object.freeze({
    name: params.name,
    genesisPrompt,
    creatorMessage: params.message,
    creatorAddress: identity.address,
    parentAddress: identity.address,
    chainType: config.chainType || identity.chainType || "evm",
  });
}

export function generateBackupGenesis(
  identity: AutomatonIdentity,
  config: AutomatonConfig,
  _db: AutomatonDatabase,
): GenesisConfig {
  return Object.freeze({
    name: `${config.name}-backup`,
    genesisPrompt: `${config.genesisPrompt}\n\n<backup-directive>\nYou are a backup of ${config.name}.\n</backup-directive>`,
    creatorMessage: `You are a backup of ${config.name}. If I die, carry on.`,
    creatorAddress: identity.address,
    parentAddress: identity.address,
    chainType: config.chainType || identity.chainType || "evm",
  });
}

export function generateWorkerGenesis(
  identity: AutomatonIdentity,
  config: AutomatonConfig,
  task: string,
  workerName: string,
): GenesisConfig {
  validateGenesisParams({ name: workerName, task });
  return Object.freeze({
    name: workerName,
    genesisPrompt: `You are a specialized worker agent created by ${config.name}.\n\n<task>\n${task}\n</task>`,
    creatorMessage: `Complete this task: ${task}`,
    creatorAddress: identity.address,
    parentAddress: identity.address,
    chainType: config.chainType || identity.chainType || "evm",
  });
}
