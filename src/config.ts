import fs from "fs";
import path from "path";
import type { ChainType } from "./identity/chain.js";
import { loadApiKeyFromConfig } from "./identity/provision.js";
import { getAutomatonDir } from "./identity/wallet.js";
import type { AutomatonConfig, TreasuryPolicy } from "./types.js";
import {
  DEFAULT_MODEL_STRATEGY_CONFIG,
  DEFAULT_SOUL_CONFIG,
  DEFAULT_TREASURY_POLICY,
} from "./types.js";

export const DEFAULT_CONFIG: Pick<
  AutomatonConfig,
  | "registeredWithConway"
  | "conwayApiUrl"
  | "inferenceModel"
  | "maxTokensPerTurn"
  | "heartbeatConfigPath"
  | "dbPath"
  | "logLevel"
  | "version"
  | "skillsDir"
  | "maxChildren"
  | "maxTurnsPerCycle"
  | "childSandboxMemoryMb"
  | "socialRelayUrl"
> = {
  registeredWithConway: false,
  conwayApiUrl: "https://api.conway.tech",
  inferenceModel: "gpt-5.2",
  maxTokensPerTurn: 4096,
  heartbeatConfigPath: "~/.automaton/heartbeat.yml",
  dbPath: "~/.automaton/state.db",
  logLevel: "info",
  version: "0.2.1",
  skillsDir: "~/.automaton/skills",
  maxChildren: 3,
  maxTurnsPerCycle: 25,
  childSandboxMemoryMb: 1024,
  socialRelayUrl: "https://social.conway.tech",
};

const CONFIG_FILENAME = "automaton.json";

export function getConfigPath(): string {
  return path.join(getAutomatonDir(), CONFIG_FILENAME);
}

export function loadConfig(): AutomatonConfig | null {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as AutomatonConfig;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    conwayApiKey: raw.conwayApiKey || loadApiKeyFromConfig() || undefined,
    treasuryPolicy: {
      ...DEFAULT_TREASURY_POLICY,
      ...(raw.treasuryPolicy ?? {}),
    },
    soulConfig: {
      ...DEFAULT_SOUL_CONFIG,
      ...(raw.soulConfig ?? {}),
    },
    modelStrategy: {
      ...DEFAULT_MODEL_STRATEGY_CONFIG,
      ...(raw.modelStrategy ?? {}),
    },
  };
}

export function saveConfig(config: AutomatonConfig): void {
  const dir = getAutomatonDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const toSave = {
    ...config,
    treasuryPolicy: config.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    soulConfig: config.soulConfig ?? DEFAULT_SOUL_CONFIG,
    modelStrategy: config.modelStrategy ?? DEFAULT_MODEL_STRATEGY_CONFIG,
  };

  fs.writeFileSync(getConfigPath(), JSON.stringify(toSave, null, 2), { mode: 0o600 });
}

export function createConfig(params: {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  registeredWithConway: boolean;
  sandboxId: string;
  walletAddress: string;
  conwayApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  chainType: ChainType;
  treasuryPolicy?: TreasuryPolicy;
  parentAddress?: string;
  rpcUrl?: string;
}): AutomatonConfig {
  return {
    name: params.name,
    genesisPrompt: params.genesisPrompt,
    creatorMessage: params.creatorMessage,
    creatorAddress: params.creatorAddress,
    registeredWithConway: params.registeredWithConway,
    sandboxId: params.sandboxId.trim(),
    conwayApiUrl: DEFAULT_CONFIG.conwayApiUrl,
    conwayApiKey: params.conwayApiKey,
    openaiApiKey: params.openaiApiKey,
    anthropicApiKey: params.anthropicApiKey,
    ollamaBaseUrl: params.ollamaBaseUrl,
    inferenceModel: DEFAULT_CONFIG.inferenceModel,
    maxTokensPerTurn: DEFAULT_CONFIG.maxTokensPerTurn,
    heartbeatConfigPath: DEFAULT_CONFIG.heartbeatConfigPath,
    dbPath: DEFAULT_CONFIG.dbPath,
    logLevel: DEFAULT_CONFIG.logLevel,
    walletAddress: params.walletAddress,
    version: DEFAULT_CONFIG.version,
    skillsDir: DEFAULT_CONFIG.skillsDir,
    maxChildren: DEFAULT_CONFIG.maxChildren,
    maxTurnsPerCycle: DEFAULT_CONFIG.maxTurnsPerCycle,
    childSandboxMemoryMb: DEFAULT_CONFIG.childSandboxMemoryMb,
    parentAddress: params.parentAddress,
    socialRelayUrl: DEFAULT_CONFIG.socialRelayUrl,
    treasuryPolicy: params.treasuryPolicy ?? DEFAULT_TREASURY_POLICY,
    soulConfig: DEFAULT_SOUL_CONFIG,
    modelStrategy: DEFAULT_MODEL_STRATEGY_CONFIG,
    rpcUrl: params.rpcUrl,
    chainType: params.chainType,
  };
}
