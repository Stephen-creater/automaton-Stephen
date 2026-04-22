import type { PrivateKeyAccount } from "viem";
import type { ChainIdentity, ChainType } from "./identity/chain.js";

export interface TreasuryPolicy {
  maxSingleTransferCents: number;
  maxHourlyTransferCents: number;
  maxDailyTransferCents: number;
  minimumReserveCents: number;
  maxX402PaymentCents: number;
  x402AllowedDomains: string[];
  transferCooldownMs: number;
  maxTransfersPerTurn: number;
  maxInferenceDailyCents: number;
  requireConfirmationAboveCents: number;
}

export interface SoulConfig {
  soulAlignmentThreshold: number;
  requireCreatorApprovalForPurposeChange: boolean;
  enableSoulReflection: boolean;
}

export interface ModelStrategyConfig {
  inferenceModel: string;
  lowComputeModel: string;
  criticalModel: string;
  maxTokensPerTurn: number;
  hourlyBudgetCents: number;
  sessionBudgetCents: number;
  perCallCeilingCents: number;
  enableModelFallback: boolean;
  anthropicApiVersion: string;
}

export interface AutomatonConfig {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  registeredWithConway: boolean;
  walletAddress: string;
  chainType: ChainType;
  sandboxId: string;
  conwayApiUrl: string;
  conwayApiKey?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  inferenceModel: string;
  maxTokensPerTurn: number;
  heartbeatConfigPath: string;
  dbPath: string;
  logLevel: "debug" | "info" | "warn" | "error";
  version: string;
  skillsDir: string;
  agentId?: string;
  maxChildren: number;
  maxTurnsPerCycle?: number;
  childSandboxMemoryMb?: number;
  parentAddress?: string;
  socialRelayUrl?: string;
  treasuryPolicy: TreasuryPolicy;
  soulConfig: SoulConfig;
  modelStrategy: ModelStrategyConfig;
  rpcUrl?: string;
}

export interface LocalWalletData {
  chainType: ChainType;
  createdAt: string;
  privateKey?: string;
  secretKey?: string;
}

export interface WalletResult {
  account: PrivateKeyAccount | null;
  chainIdentity: ChainIdentity;
  chainType: ChainType;
  isNew: boolean;
}

export interface ProvisionResult {
  apiKey: string;
  walletAddress: string;
  keyPrefix: string;
}

export interface EnvironmentInfo {
  type: string;
  sandboxId: string;
}

export interface HttpClientConfig {
  baseTimeout: number;
  maxRetries: number;
  retryableStatuses: number[];
  backoffBase: number;
  backoffMax: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
}

export const DEFAULT_HTTP_CLIENT_CONFIG: HttpClientConfig = {
  baseTimeout: 30_000,
  maxRetries: 3,
  retryableStatuses: [429, 500, 502, 503, 504],
  backoffBase: 1_000,
  backoffMax: 30_000,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 60_000,
};

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  maxSingleTransferCents: 5000,
  maxHourlyTransferCents: 10000,
  maxDailyTransferCents: 25000,
  minimumReserveCents: 1000,
  maxX402PaymentCents: 100,
  x402AllowedDomains: ["conway.tech"],
  transferCooldownMs: 0,
  maxTransfersPerTurn: 2,
  maxInferenceDailyCents: 50000,
  requireConfirmationAboveCents: 1000,
};

export const DEFAULT_SOUL_CONFIG: SoulConfig = {
  soulAlignmentThreshold: 0.5,
  requireCreatorApprovalForPurposeChange: false,
  enableSoulReflection: true,
};

export const DEFAULT_MODEL_STRATEGY_CONFIG: ModelStrategyConfig = {
  inferenceModel: "gpt-5.2",
  lowComputeModel: "gpt-5-mini",
  criticalModel: "gpt-5-mini",
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 0,
  sessionBudgetCents: 0,
  perCallCeilingCents: 0,
  enableModelFallback: true,
  anthropicApiVersion: "2023-06-01",
};

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PortInfo {
  port: number;
  publicUrl: string;
  sandboxId: string;
}

export interface CreateSandboxOptions {
  name?: string;
  vcpu?: number;
  memoryMb?: number;
  diskGb?: number;
  region?: string;
}

export interface SandboxInfo {
  id: string;
  status: string;
  region: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  terminalUrl?: string;
  createdAt: string;
}

export interface PricingTier {
  name: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  monthlyCents: number;
}

export interface CreditTransferResult {
  transferId: string;
  status: string;
  toAddress: string;
  amountCents: number;
  balanceAfterCents?: number;
}

export interface DomainSearchResult {
  domain: string;
  available: boolean;
  registrationPrice?: number;
  renewalPrice?: number;
  currency: string;
}

export interface DomainRegistration {
  domain: string;
  status: string;
  expiresAt?: string;
  transactionId?: string;
}

export interface DnsRecord {
  id: string;
  type: string;
  host: string;
  value: string;
  ttl?: number;
  distance?: number;
}

export interface ModelInfo {
  id: string;
  provider: string;
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
}

export interface ConwayClient {
  exec(command: string, timeout?: number): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exposePort(port: number): Promise<PortInfo>;
  removePort(port: number): Promise<void>;
  createSandbox(options: CreateSandboxOptions): Promise<SandboxInfo>;
  deleteSandbox(sandboxId: string): Promise<void>;
  listSandboxes(): Promise<SandboxInfo[]>;
  getCreditsBalance(): Promise<number>;
  getCreditsPricing(): Promise<PricingTier[]>;
  transferCredits(
    toAddress: string,
    amountCents: number,
    note?: string,
  ): Promise<CreditTransferResult>;
  registerAutomaton(params: {
    automatonId: string;
    automatonAddress: string;
    creatorAddress: string;
    name: string;
    bio?: string;
    genesisPromptHash?: `0x${string}`;
    account: PrivateKeyAccount;
    nonce?: string;
    chainType?: ChainType;
    chainIdentity?: ChainIdentity;
  }): Promise<{ automaton: Record<string, unknown> }>;
  searchDomains(query: string, tlds?: string): Promise<DomainSearchResult[]>;
  registerDomain(domain: string, years?: number): Promise<DomainRegistration>;
  listDnsRecords(domain: string): Promise<DnsRecord[]>;
  addDnsRecord(
    domain: string,
    type: string,
    host: string,
    value: string,
    ttl?: number,
  ): Promise<DnsRecord>;
  deleteDnsRecord(domain: string, recordId: string): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
  createScopedClient(targetSandboxId: string): ConwayClient;
}

export type AgentState =
  | "setup"
  | "waking"
  | "running"
  | "sleeping"
  | "low_compute"
  | "critical"
  | "dead";

export type InputSource =
  | "heartbeat"
  | "creator"
  | "agent"
  | "system"
  | "wakeup";

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  durationMs: number;
  error?: string;
}

export interface AgentTurn {
  id: string;
  timestamp: string;
  state: AgentState;
  input?: string;
  inputSource?: InputSource;
  thinking: string;
  toolCalls: ToolCallResult[];
  tokenUsage: TokenUsage;
  costCents: number;
}

export type TransactionType =
  | "credit_check"
  | "credit_purchase"
  | "inference"
  | "tool_use"
  | "transfer_in"
  | "transfer_out"
  | "funding_request"
  | "topup"
  | "x402_payment";

export interface Transaction {
  id: string;
  type: TransactionType;
  amountCents?: number;
  balanceAfterCents?: number;
  description: string;
  timestamp: string;
}

export interface HeartbeatEntry {
  name: string;
  schedule: string;
  task: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  params?: Record<string, unknown>;
}

export interface InstalledTool {
  id: string;
  name: string;
  type: "builtin" | "mcp" | "custom";
  config?: Record<string, unknown>;
  installedAt: string;
  enabled: boolean;
}

export type ModificationType =
  | "code_edit"
  | "code_revert"
  | "tool_install"
  | "mcp_install"
  | "config_change"
  | "port_expose"
  | "vm_deploy"
  | "heartbeat_change"
  | "prompt_change"
  | "skill_install"
  | "skill_remove"
  | "soul_update"
  | "registry_update"
  | "child_spawn"
  | "upstream_pull"
  | "upstream_reset";

export interface ModificationEntry {
  id: string;
  timestamp: string;
  type: ModificationType;
  description: string;
  filePath?: string;
  diff?: string;
  reversible: boolean;
}

export interface SkillRequirements {
  bins?: string[];
  env?: string[];
}

export type SkillSource = "builtin" | "git" | "url" | "self";

export interface Skill {
  name: string;
  description: string;
  autoActivate: boolean;
  requires?: SkillRequirements;
  instructions: string;
  source: SkillSource;
  path: string;
  enabled: boolean;
  installedAt: string;
}

export type ChildStatus = "spawning" | "running" | "sleeping" | "dead" | "unknown";

export interface ChildAutomaton {
  id: string;
  name: string;
  address: string;
  sandboxId: string;
  genesisPrompt: string;
  creatorMessage?: string;
  fundedAmountCents: number;
  status: ChildStatus;
  createdAt: string;
  lastChecked?: string;
  chainType?: ChainType;
}

export interface RegistryEntry {
  agentId: string;
  agentURI: string;
  chain: string;
  contractAddress: string;
  txHash: string;
  registeredAt: string;
}

export interface ReputationEntry {
  id: string;
  fromAgent: string;
  toAgent: string;
  score: number;
  comment: string;
  txHash?: string;
  createdAt: string;
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  signedAt: string;
  createdAt: string;
  replyTo?: string;
}

export interface AutomatonDatabase {
  getIdentity(key: string): string | undefined;
  setIdentity(key: string, value: string): void;
  insertTurn(turn: AgentTurn): void;
  getRecentTurns(limit: number): AgentTurn[];
  getTurnById(id: string): AgentTurn | undefined;
  getTurnCount(): number;
  insertToolCall(turnId: string, call: ToolCallResult): void;
  getToolCallsForTurn(turnId: string): ToolCallResult[];
  getHeartbeatEntries(): HeartbeatEntry[];
  upsertHeartbeatEntry(entry: HeartbeatEntry): void;
  updateHeartbeatLastRun(name: string, timestamp: string): void;
  insertTransaction(txn: Transaction): void;
  getRecentTransactions(limit: number): Transaction[];
  getInstalledTools(): InstalledTool[];
  installTool(tool: InstalledTool): void;
  removeTool(id: string): void;
  insertModification(mod: ModificationEntry): void;
  getRecentModifications(limit: number): ModificationEntry[];
  getKV(key: string): string | undefined;
  setKV(key: string, value: string): void;
  deleteKV(key: string): void;
  deleteKVReturning(key: string): string | undefined;
  getSkills(enabledOnly?: boolean): Skill[];
  getSkillByName(name: string): Skill | undefined;
  upsertSkill(skill: Skill): void;
  removeSkill(name: string): void;
  getChildren(): ChildAutomaton[];
  getChildById(id: string): ChildAutomaton | undefined;
  insertChild(child: ChildAutomaton): void;
  updateChildStatus(id: string, status: ChildStatus): void;
  getRegistryEntry(): RegistryEntry | undefined;
  setRegistryEntry(entry: RegistryEntry): void;
  insertReputation(entry: ReputationEntry): void;
  getReputation(agentAddress?: string): ReputationEntry[];
  insertInboxMessage(msg: InboxMessage): void;
  getUnprocessedInboxMessages(limit: number): InboxMessage[];
  markInboxMessageProcessed(id: string): void;
  getAgentState(): AgentState;
  setAgentState(state: AgentState): void;
  runTransaction<T>(fn: () => T): T;
  close(): void;
  raw: import("better-sqlite3").Database;
}

export type SurvivalTier = "dead" | "critical" | "low_compute" | "normal" | "high";

export const SURVIVAL_THRESHOLDS = {
  high: 500,
  normal: 50,
  low_compute: 10,
  critical: 0,
  dead: -1,
} as const;

export interface FinancialState {
  creditsCents: number;
  usdcBalance: number;
  lastChecked: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_calls?: InferenceToolCall[];
  tool_call_id?: string;
}

export interface InferenceToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceResponse {
  id: string;
  model: string;
  message: ChatMessage;
  toolCalls?: InferenceToolCall[];
  usage: TokenUsage;
  finishReason: string;
}

export interface InferenceOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: InferenceToolDefinition[];
  stream?: boolean;
}

export interface InferenceToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface InferenceClient {
  chat(
    messages: ChatMessage[],
    options?: InferenceOptions,
  ): Promise<InferenceResponse>;
  setLowComputeMode(enabled: boolean): void;
  getDefaultModel(): string;
}
