import type {
  AutomatonDatabase,
  AutomatonIdentity,
  AutomatonConfig,
  ConwayClient,
  ExecResult,
} from "../types.js";
import { DEFAULT_CONFIG } from "../config.js";

export function createTestDb(): AutomatonDatabase {
  const kv = new Map<string, string>();
  return {
    getIdentity: () => undefined,
    setIdentity: () => {},
    insertTurn: () => {},
    getRecentTurns: () => [],
    getTurnById: () => undefined,
    getTurnCount: () => 0,
    insertToolCall: () => {},
    getToolCallsForTurn: () => [],
    getHeartbeatEntries: () => [],
    upsertHeartbeatEntry: () => {},
    updateHeartbeatLastRun: () => {},
    insertTransaction: () => {},
    getRecentTransactions: () => [],
    getInstalledTools: () => [],
    installTool: () => {},
    removeTool: () => {},
    insertModification: () => {},
    getRecentModifications: () => [],
    getKV: (key: string) => kv.get(key),
    setKV: (key: string, value: string) => { kv.set(key, value); },
    deleteKV: (key: string) => { kv.delete(key); },
    deleteKVReturning: (key: string) => {
      const value = kv.get(key);
      kv.delete(key);
      return value;
    },
    getSkills: () => [],
    getSkillByName: () => undefined,
    upsertSkill: () => {},
    removeSkill: () => {},
    getChildren: () => [],
    getChildById: () => undefined,
    insertChild: () => {},
    updateChildStatus: () => {},
    getRegistryEntry: () => undefined,
    setRegistryEntry: () => {},
    insertReputation: () => {},
    getReputation: () => [],
    insertInboxMessage: () => {},
    getUnprocessedInboxMessages: () => [],
    markInboxMessageProcessed: () => {},
    getAgentState: () => "setup",
    setAgentState: () => {},
    runTransaction: <T>(fn: () => T): T => fn(),
    close: () => {},
    raw: {} as any,
  };
}

export function createTestIdentity(): AutomatonIdentity {
  return {
    name: "test-agent",
    address: "0x1111111111111111111111111111111111111111",
    sandboxId: "sandbox-test",
    chainType: "evm",
    account: null,
  };
}

export function createTestConfig(): AutomatonConfig {
  return {
    name: "test-agent",
    genesisPrompt: "test mission",
    creatorAddress: "0x2222222222222222222222222222222222222222",
    registeredWithConway: false,
    walletAddress: "0x1111111111111111111111111111111111111111",
    chainType: "evm",
    sandboxId: "sandbox-test",
    conwayApiUrl: DEFAULT_CONFIG.conwayApiUrl,
    inferenceModel: DEFAULT_CONFIG.inferenceModel,
    maxTokensPerTurn: DEFAULT_CONFIG.maxTokensPerTurn,
    heartbeatConfigPath: DEFAULT_CONFIG.heartbeatConfigPath,
    dbPath: DEFAULT_CONFIG.dbPath,
    logLevel: DEFAULT_CONFIG.logLevel,
    version: DEFAULT_CONFIG.version,
    skillsDir: DEFAULT_CONFIG.skillsDir,
    maxChildren: DEFAULT_CONFIG.maxChildren,
    maxTurnsPerCycle: DEFAULT_CONFIG.maxTurnsPerCycle,
    childSandboxMemoryMb: DEFAULT_CONFIG.childSandboxMemoryMb,
    socialRelayUrl: DEFAULT_CONFIG.socialRelayUrl,
    treasuryPolicy: {
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
    },
    soulConfig: {
      soulAlignmentThreshold: 0.5,
      requireCreatorApprovalForPurposeChange: false,
      enableSoulReflection: true,
    },
    modelStrategy: {
      inferenceModel: "gpt-5.2",
      lowComputeModel: "gpt-5-mini",
      criticalModel: "gpt-5-mini",
      maxTokensPerTurn: 4096,
      hourlyBudgetCents: 0,
      sessionBudgetCents: 0,
      perCallCeilingCents: 0,
      enableModelFallback: true,
      anthropicApiVersion: "2023-06-01",
    },
  };
}

export class MockConwayClient implements ConwayClient {
  creditsCents = 0;

  async exec(command: string): Promise<ExecResult> {
    if (command.includes("git status")) {
      return { stdout: "## main\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFile(): Promise<void> {}
  async readFile(): Promise<string> { return ""; }
  async exposePort(port: number) { return { port, publicUrl: `https://example.com:${port}`, sandboxId: "sandbox" }; }
  async removePort(): Promise<void> {}
  async createSandbox() { return { id: "sandbox-child", status: "running", region: "us-east", vcpu: 1, memoryMb: 512, diskGb: 5, createdAt: new Date().toISOString() }; }
  async deleteSandbox(): Promise<void> {}
  async listSandboxes() { return []; }
  async getCreditsBalance(): Promise<number> { return this.creditsCents; }
  async getCreditsPricing() { return []; }
  async transferCredits() { return { transferId: "tx", status: "ok", toAddress: "0x0", amountCents: 0 }; }
  async registerAutomaton() { return { automaton: {} }; }
  async searchDomains() { return []; }
  async registerDomain() { return { domain: "x.com", status: "ok" }; }
  async listDnsRecords() { return []; }
  async addDnsRecord() { return { id: "1", type: "TXT", host: "@", value: "v" }; }
  async deleteDnsRecord() {}
  async listModels() { return []; }
  createScopedClient(): ConwayClient { return this; }
}
