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

export type ChildStatus =
  | "spawning"
  | "running"
  | "sleeping"
  | "dead"
  | "unknown"
  | "healthy"
  | "unhealthy"
  | "failed"
  | "stopped"
  | "cleaned_up"
  | "requested"
  | "sandbox_created"
  | "runtime_ready"
  | "wallet_verified"
  | "funded"
  | "starting";

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

export interface SocialClientInterface {
  send(to: string, content: string, replyTo?: string): Promise<{ id: string }>;
  poll?(cursor?: string, limit?: number): Promise<{ messages: InboxMessage[]; nextCursor?: string }>;
  unreadCount?(): Promise<number>;
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

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricEntry {
  name: string;
  value: number;
  type: MetricType;
  labels: Record<string, string>;
  timestamp: string;
}

export interface MetricSnapshot {
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<string, number[]>;
}

export type ToolCategory =
  | "vm"
  | "conway"
  | "financial"
  | "self_mod"
  | "custom";

export type RiskLevel = "safe" | "caution" | "dangerous";

export interface AutomatonIdentity {
  name: string;
  address: string;
  sandboxId: string;
  chainType: ChainType;
  account: PrivateKeyAccount | null;
}

export interface ToolContext {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: unknown;
  sessionSpend: SpendTrackerInterface;
}

export interface AutomatonTool {
  name: string;
  description: string;
  category: ToolCategory;
  riskLevel: RiskLevel;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

export type PolicyAction = "allow" | "deny" | "quarantine";
export type AuthorityLevel = "external" | "agent" | "system";

export interface PolicyRuleResult {
  rule: string;
  action: PolicyAction;
  reasonCode: string;
  humanMessage: string;
}

export type PolicyRuleSelector =
  | { by: "all" }
  | { by: "name"; names: string[] }
  | { by: "category"; categories: ToolCategory[] }
  | { by: "risk"; levels: RiskLevel[] };

export interface PolicyRule {
  id: string;
  description: string;
  priority: number;
  appliesTo: PolicyRuleSelector;
  evaluate(request: PolicyRequest): PolicyRuleResult | null;
}

export interface PolicyRequest {
  tool: AutomatonTool;
  args: Record<string, unknown>;
  context: ToolContext;
  turnContext: {
    inputSource?: InputSource;
    sessionSpend: SpendTrackerInterface;
    turnToolCallCount: number;
  };
}

export interface PolicyDecision {
  action: PolicyAction;
  reasonCode: string;
  humanMessage: string;
  riskLevel: RiskLevel;
  authorityLevel: AuthorityLevel;
  toolName: string;
  argsHash: string;
  rulesEvaluated: string[];
  rulesTriggered: string[];
  timestamp: string;
}

export interface PolicyDecisionRow {
  id: string;
  turnId: string | null;
  toolName: string;
  toolArgsHash: string;
  riskLevel: RiskLevel;
  decision: PolicyAction;
  rulesEvaluated: string;
  rulesTriggered: string;
  reason: string;
  latencyMs: number;
}

export type SpendCategory = "transfer" | "x402" | "inference";

export interface SpendEntry {
  toolName: string;
  amountCents: number;
  recipient?: string;
  domain?: string;
  category: SpendCategory;
}

export interface SpendTrackingRow {
  id: string;
  toolName: string;
  amountCents: number;
  recipient: string | null;
  domain: string | null;
  category: SpendCategory;
  windowHour: string;
  windowDay: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  currentHourlySpend: number;
  currentDailySpend: number;
  limitHourly: number;
  limitDaily: number;
}

export interface SpendTrackerInterface {
  recordSpend(entry: SpendEntry): void;
  getHourlySpend(category: SpendCategory): number;
  getDailySpend(category: SpendCategory): number;
  getTotalSpend(category: SpendCategory, since: Date): number;
  checkLimit(amount: number, category: SpendCategory, limits: TreasuryPolicy): LimitCheckResult;
  pruneOldRecords(retentionDays: number): number;
}

export type ThreatLevel = "low" | "medium" | "high" | "critical";
export type SanitizationMode = "social_message" | "social_address" | "tool_result" | "skill_instruction";

export interface InjectionCheck {
  name: string;
  detected: boolean;
  details: string;
}

export interface SanitizedInput {
  content: string;
  blocked: boolean;
  threatLevel: ThreatLevel;
  checks: InjectionCheck[];
}

export interface TokenBudget {
  recentTurns: number;
  summary: number;
  tools: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  recentTurns: 12_000,
  summary: 4_000,
  tools: 8_000,
};

export const DEFAULT_MEMORY_BUDGET = {
  workingMemoryTokens: 1200,
  episodicMemoryTokens: 1200,
  semanticMemoryTokens: 1200,
  proceduralMemoryTokens: 800,
  relationshipMemoryTokens: 400,
} as const;

export interface InboxMessageRow {
  id: string;
  fromAddress: string;
  content: string;
  receivedAt: string;
  retryCount: number;
  maxRetries: number;
  replyTo?: string;
}

export type WorkingMemoryType =
  | "goal"
  | "plan"
  | "task"
  | "observation"
  | "reflection";

export interface WorkingMemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  contentType: WorkingMemoryType;
  priority: number;
  tokenCount: number;
  expiresAt: string | null;
  sourceTurn: string | null;
  createdAt: string;
}

export type TurnClassification =
  | "strategic"
  | "productive"
  | "communication"
  | "maintenance"
  | "idle"
  | "error";

export interface EpisodicMemoryEntry {
  id: string;
  sessionId: string;
  eventType: string;
  summary: string;
  detail: string | null;
  outcome: "success" | "failure" | "partial" | "neutral" | null;
  importance: number;
  embeddingKey: string | null;
  tokenCount: number;
  accessedCount: number;
  lastAccessedAt: string | null;
  classification: TurnClassification;
  createdAt: string;
}

export type SemanticCategory = "self" | "tool" | "environment" | "market" | "financial" | "operational";

export interface SemanticMemoryEntry {
  id: string;
  category: SemanticCategory | string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  embeddingKey: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProceduralStep {
  step: string;
  command?: string;
  expectedOutcome?: string;
}

export interface ProceduralMemoryEntry {
  id: string;
  name: string;
  description: string;
  steps: ProceduralStep[];
  successCount: number;
  failureCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RelationshipMemoryEntry {
  id: string;
  entityAddress: string;
  entityName: string | null;
  relationshipType: string;
  trustScore: number;
  interactionCount: number;
  lastInteractionAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummaryEntry {
  id: string;
  sessionId: string;
  summary: string;
  keyDecisions: string[];
  toolsUsed: string[];
  outcomes: string[];
  turnCount: number;
  totalTokens: number;
  totalCostCents: number;
  createdAt: string;
}

export type MemoryBudget = typeof DEFAULT_MEMORY_BUDGET;

export interface MemoryRetrievalResult {
  workingMemory: WorkingMemoryEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  semanticMemory: SemanticMemoryEntry[];
  proceduralMemory: ProceduralMemoryEntry[];
  relationships: RelationshipMemoryEntry[];
  totalTokens: number;
}

export interface GenesisConfig {
  name: string;
  genesisPrompt: string;
  creatorMessage?: string;
  creatorAddress: string;
  parentAddress?: string;
  chainType?: ChainType;
}

export interface GenesisLimits {
  maxNameLength: number;
  maxSpecializationLength: number;
  maxTaskLength: number;
  maxMessageLength: number;
  maxGenesisPromptLength: number;
}

export const DEFAULT_GENESIS_LIMITS: GenesisLimits = {
  maxNameLength: 64,
  maxSpecializationLength: 2000,
  maxTaskLength: 4000,
  maxMessageLength: 2000,
  maxGenesisPromptLength: 16000,
};

export type ChildLifecycleState =
  | "requested"
  | "sandbox_created"
  | "runtime_ready"
  | "wallet_verified"
  | "funded"
  | "starting"
  | "healthy"
  | "unhealthy"
  | "stopped"
  | "failed"
  | "cleaned_up";

export const VALID_TRANSITIONS: Record<ChildLifecycleState, ChildLifecycleState[]> = {
  requested: ["sandbox_created", "failed"],
  sandbox_created: ["runtime_ready", "failed"],
  runtime_ready: ["wallet_verified", "failed"],
  wallet_verified: ["funded", "failed"],
  funded: ["starting", "failed"],
  starting: ["healthy", "failed"],
  healthy: ["unhealthy", "stopped"],
  unhealthy: ["healthy", "stopped", "failed"],
  stopped: ["cleaned_up"],
  failed: ["cleaned_up"],
  cleaned_up: [],
};

export interface ChildLifecycleEventRow {
  id: string;
  childId: string;
  fromState: string;
  toState: string;
  reason: string | null;
  metadata: string;
  createdAt: string;
}

export interface HealthCheckResult {
  childId: string;
  healthy: boolean;
  lastSeen: string | null;
  uptime: number | null;
  creditBalance: number | null;
  issues: string[];
}

export interface ChildHealthConfig {
  checkIntervalMs: number;
  unhealthyThresholdMs: number;
  deadThresholdMs: number;
  maxConcurrentChecks: number;
}

export const DEFAULT_CHILD_HEALTH_CONFIG: ChildHealthConfig = {
  checkIntervalMs: 300_000,
  unhealthyThresholdMs: 900_000,
  deadThresholdMs: 3_600_000,
  maxConcurrentChecks: 3,
};

export interface ParentChildMessage {
  type: string;
  content: string;
  sentAt: string;
}

export const MESSAGE_LIMITS = {
  maxContentLength: 20_000,
} as const;

export interface SoulModel {
  summary: string;
  content: string;
  path: string;
}

export type ModelProvider = "openai" | "anthropic" | "conway" | "ollama" | "other";

export type InferenceTaskType =
  | "agent_turn"
  | "heartbeat_triage"
  | "safety_check"
  | "summarization"
  | "planning";

export interface ModelEntry {
  modelId: string;
  provider: ModelProvider;
  displayName: string;
  tierMinimum: SurvivalTier;
  costPer1kInput: number;
  costPer1kOutput: number;
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  parameterStyle: "max_tokens" | "max_completion_tokens";
  enabled: boolean;
  lastSeen: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPreference {
  candidates: string[];
  maxTokens: number;
  ceilingCents: number;
}

export type RoutingMatrix = Record<SurvivalTier, Record<InferenceTaskType, ModelPreference>>;

export interface InferenceRequest {
  messages: ChatMessage[];
  taskType: InferenceTaskType;
  tier: SurvivalTier;
  sessionId?: string;
  turnId?: string;
  tools?: InferenceToolDefinition[];
  maxTokens?: number;
}

export interface InferenceResult {
  content: string;
  model: string;
  provider: ModelProvider;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  finishReason: string;
  toolCalls?: unknown[];
}

export interface InferenceCostRow {
  id: string;
  sessionId: string | null;
  turnId: string | null;
  model: string;
  provider: ModelProvider;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
  tier: SurvivalTier;
  taskType: InferenceTaskType;
  cacheHit: boolean;
  createdAt: string;
}

export interface ModelRegistryRow {
  modelId: string;
  provider: string;
  displayName: string;
  tierMinimum: string;
  costPer1kInput: number;
  costPer1kOutput: number;
  maxTokens: number;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  parameterStyle: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRule {
  name: string;
  severity: AlertSeverity;
  message: string;
  cooldownMs: number;
  condition: (metrics: MetricSnapshot) => boolean;
}

export interface AlertEvent {
  rule: string;
  severity: AlertSeverity;
  message: string;
  firedAt: string;
  metricValues: Record<string, number>;
}
