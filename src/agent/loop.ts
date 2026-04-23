import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutomatonIdentity,
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  InferenceClient,
  AgentState,
  AgentTurn,
  FinancialState,
  ToolContext,
  Skill,
  SpendTrackerInterface,
  InputSource,
  ModelStrategyConfig,
  InboxMessageRow,
} from "../types.js";
import { DEFAULT_MODEL_STRATEGY_CONFIG, DEFAULT_MEMORY_BUDGET } from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import { buildSystemPrompt, buildWakeupPrompt } from "./system-prompt.js";
import { buildContextMessages, trimContext, formatMemoryBlock } from "./context.js";
import { createBuiltinTools, loadInstalledTools, toolsToInferenceFormat, executeTool } from "./tools.js";
import { sanitizeInput } from "./injection-defense.js";
import { getSurvivalTier } from "../conway/credits.js";
import { getUsdcBalance } from "../conway/x402.js";
import {
  claimInboxMessages,
  markInboxProcessed,
  markInboxFailed,
  resetInboxToReceived,
  consumeNextWakeEvent,
} from "../state/database.js";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { InferenceRouter } from "../inference/router.js";
import { MemoryRetriever } from "../memory/retrieval.js";
import { MemoryIngestionPipeline } from "../memory/ingestion.js";
import { createLogger } from "../observability/logger.js";
import { Orchestrator } from "../orchestration/orchestrator.js";
import { PlanModeController } from "../orchestration/plan-mode.js";
import { generateTodoMd, injectTodoContext } from "../orchestration/attention.js";
import { ColonyMessaging, LocalDBTransport } from "../orchestration/messaging.js";
import { LocalWorkerPool } from "../orchestration/local-worker.js";
import { SimpleAgentTracker, SimpleFundingProtocol } from "../orchestration/simple-tracker.js";
import { ContextManager, createTokenCounter } from "../memory/context-manager.js";
import { CompressionEngine } from "../memory/compression-engine.js";
import { EventStream } from "../memory/event-stream.js";
import { KnowledgeStore } from "../memory/knowledge-store.js";
import { ProviderRegistry } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";
import { SpendTracker } from "./spend-tracker.js";

const logger = createLogger("loop");
const MAX_TOOL_CALLS_PER_TURN = 10;
const MAX_CONSECUTIVE_ERRORS = 5;
const MAX_IDLE_TURNS = 10;

export interface AgentLoopOptions {
  identity: AutomatonIdentity;
  config: AutomatonConfig;
  db: AutomatonDatabase;
  conway: ConwayClient;
  inference: InferenceClient;
  social?: unknown;
  skills?: Skill[];
  policyEngine?: PolicyEngine;
  spendTracker?: SpendTrackerInterface;
  onStateChange?: (state: AgentState) => void;
  onTurnComplete?: (turn: AgentTurn) => void;
  ollamaBaseUrl?: string;
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  const {
    identity,
    config,
    db,
    conway,
    inference,
    social,
    skills,
    policyEngine,
    spendTracker = new SpendTracker(db.raw),
    onStateChange,
    onTurnComplete,
  } = options;

  const builtinTools = createBuiltinTools(identity.sandboxId);
  const installedTools = loadInstalledTools(db);
  const tools = [...builtinTools, ...installedTools];
  const toolContext: ToolContext = {
    identity,
    config,
    db,
    conway,
    inference,
    social,
    sessionSpend: spendTracker,
  };

  const modelStrategyConfig: ModelStrategyConfig = {
    ...DEFAULT_MODEL_STRATEGY_CONFIG,
    ...(config.modelStrategy ?? {}),
  };
  const modelRegistry = new ModelRegistry(db.raw);
  modelRegistry.initialize();
  const budgetTracker = new InferenceBudgetTracker(db.raw, modelStrategyConfig);
  const inferenceRouter = new InferenceRouter(db.raw, modelRegistry, budgetTracker);

  const providersPath = path.join(process.env.HOME || process.cwd(), ".automaton", "inference-providers.json");
  const providerRegistry = ProviderRegistry.fromConfig(providersPath);
  const unifiedInference = new UnifiedInferenceClient(providerRegistry);
  const orchestrator = new Orchestrator({
    db: db.raw,
    agentTracker: new SimpleAgentTracker(db),
    funding: new SimpleFundingProtocol(conway, identity, db),
    messaging: new ColonyMessaging(new LocalDBTransport(db), db),
    inference: unifiedInference,
    identity,
    config,
    workerPool: new LocalWorkerPool({ db: db.raw }),
  });
  const planModeController = new PlanModeController(db.raw);
  const contextManager = new ContextManager(createTokenCounter());
  const compressionEngine = new CompressionEngine(
    contextManager,
    new EventStream(db.raw),
    new KnowledgeStore(db.raw),
    unifiedInference,
  );
  void planModeController;
  void compressionEngine;

  ensureWorklogExists(config, db);

  while (consumeNextWakeEvent(db.raw)) {
    // Drain stale wake events before starting.
  }
  db.deleteKV("sleep_until");

  db.setAgentState("waking");
  onStateChange?.("waking");

  let financial = await getFinancialState(conway, identity.address, db, config.chainType || identity.chainType);
  const wakeupInput = buildWakeupPrompt({
    trigger: "startup",
    state: "waking",
    pendingItems: [],
  });

  db.setAgentState("running");
  onStateChange?.("running");

  let pendingInput: { content: string; source: string } | undefined = {
    content: wakeupInput,
    source: "wakeup",
  };
  let running = true;
  let consecutiveErrors = 0;
  let idleTurnCount = 0;

  while (running) {
    let claimedMessages: InboxMessageRow[] = [];

    try {
      const sleepUntil = db.getKV("sleep_until");
      if (sleepUntil && new Date(sleepUntil) > new Date()) {
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        break;
      }

      if (!pendingInput) {
        claimedMessages = claimInboxMessages(db.raw, 10);
        if (claimedMessages.length > 0) {
          const formatted = claimedMessages
            .map((message) => {
              const from = sanitizeInput(message.fromAddress, message.fromAddress, "social_address");
              const content = sanitizeInput(message.content, message.fromAddress, "social_message");
              return content.blocked
                ? `[INJECTION BLOCKED from ${from.content}]`
                : `[Message from ${from.content}]: ${content.content}`;
            })
            .join("\n\n");
          pendingInput = { content: formatted, source: "agent" };
        }
      }

      financial = await getFinancialState(conway, identity.address, db, config.chainType || identity.chainType);
      const survivalTier = getSurvivalTier(financial.creditsCents);

      if (survivalTier === "critical") {
        db.setAgentState("critical");
        onStateChange?.("critical");
        inference.setLowComputeMode(true);
      } else if (survivalTier === "low_compute") {
        db.setAgentState("low_compute");
        onStateChange?.("low_compute");
        inference.setLowComputeMode(true);
      } else {
        db.setAgentState("running");
        onStateChange?.("running");
        inference.setLowComputeMode(false);
      }

      const allTurns = db.getRecentTurns(20);
      const recentTurns = trimContext(allTurns.length > 0 ? allTurns : []);
      const systemPrompt = buildSystemPrompt({
        identity,
        config,
        db,
        state: db.getAgentState(),
        tools,
        skills,
        financialState: financial,
      });

      const memoryRetriever = new MemoryRetriever(db.raw, DEFAULT_MEMORY_BUDGET);
      const memoryResult = memoryRetriever.retrieve(db.getKV("session_id") || "default", pendingInput?.content);
      let messages = buildContextMessages(systemPrompt, recentTurns, pendingInput);
      if (memoryResult.totalTokens > 0) {
        messages.splice(1, 0, { role: "system", content: formatMemoryBlock(memoryResult) });
      }

      const orchestratorTick = await orchestrator.tick();
      db.setKV("orchestrator.last_tick", JSON.stringify(orchestratorTick));
      messages = injectTodoContext(messages, generateTodoMd(db.raw));

      const currentInput = pendingInput;
      pendingInput = undefined;

      const routerResult = await inferenceRouter.route(
        {
          messages,
          taskType: "agent_turn",
          tier: survivalTier,
          sessionId: db.getKV("session_id") || "default",
          turnId: randomUUID(),
          tools: toolsToInferenceFormat(tools),
        },
        (msgs, opts) => inference.chat(msgs, opts as any),
      );

      const turn: AgentTurn = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        state: db.getAgentState(),
        input: currentInput?.content,
        inputSource: currentInput?.source as InputSource | undefined,
        thinking: routerResult.content || "",
        toolCalls: [],
        tokenUsage: {
          promptTokens: routerResult.inputTokens,
          completionTokens: routerResult.outputTokens,
          totalTokens: routerResult.inputTokens + routerResult.outputTokens,
        },
        costCents: routerResult.costCents,
      };

      const toolCalls = Array.isArray(routerResult.toolCalls) ? routerResult.toolCalls : [];
      let callCount = 0;
      for (const rawToolCall of toolCalls) {
        if (callCount >= MAX_TOOL_CALLS_PER_TURN) break;
        const toolCall = normalizeToolCall(rawToolCall);
        if (!toolCall) continue;
        const result = await executeTool({
          toolName: toolCall.name,
          args: toolCall.arguments,
          tools,
          context: toolContext,
          turnId: turn.id,
          policyEngine,
          turnContext: {
            inputSource: currentInput?.source as InputSource | undefined,
            turnToolCallCount: turn.toolCalls.length,
            sessionSpend: spendTracker,
          },
        });
        result.id = toolCall.id;
        turn.toolCalls.push(result);
        callCount += 1;
      }

      db.runTransaction(() => {
        db.insertTurn(turn);
        for (const toolCall of turn.toolCalls) {
          db.insertToolCall(turn.id, toolCall);
        }
        if (claimedMessages.length > 0) {
          markInboxProcessed(db.raw, claimedMessages.map((message) => message.id));
        }
      });
      onTurnComplete?.(turn);

      new MemoryIngestionPipeline(db.raw).ingest(db.getKV("session_id") || "default", turn, turn.toolCalls);
      writePersistentWorklog(config, db, turn);

      const sleepTool = turn.toolCalls.find((toolCall) => toolCall.name === "sleep");
      if (sleepTool && !sleepTool.error) {
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
        break;
      }

      const didMutate = turn.toolCalls.some((toolCall) => isMutatingTool(toolCall.name));
      if (!currentInput && !didMutate) {
        idleTurnCount += 1;
        if (idleTurnCount >= MAX_IDLE_TURNS) {
          db.setKV("sleep_until", new Date(Date.now() + 60_000).toISOString());
          db.setAgentState("sleeping");
          onStateChange?.("sleeping");
          running = false;
        }
      } else {
        idleTurnCount = 0;
      }

      if ((!routerResult.toolCalls || routerResult.toolCalls.length === 0) && routerResult.finishReason === "stop") {
        db.setKV("sleep_until", new Date(Date.now() + 60_000).toISOString());
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        running = false;
      }

      consecutiveErrors = 0;
    } catch (error: any) {
      consecutiveErrors += 1;
      logger.error(`Turn failed: ${error.message}`, error instanceof Error ? error : undefined);

      if (claimedMessages.length > 0) {
        markInboxFailed(db.raw, claimedMessages.map((message) => message.id));
        resetInboxToReceived(db.raw, []);
      }

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        db.setAgentState("sleeping");
        onStateChange?.("sleeping");
        db.setKV("sleep_until", new Date(Date.now() + 300_000).toISOString());
        running = false;
      }
    }
  }
}

let lastKnownCredits = 0;
let lastKnownUsdc = 0;

async function getFinancialState(
  conway: ConwayClient,
  address: string,
  db?: AutomatonDatabase,
  chainType?: string,
): Promise<FinancialState> {
  let creditsCents = lastKnownCredits;
  let usdcBalance = lastKnownUsdc;

  try {
    creditsCents = await conway.getCreditsBalance();
    if (creditsCents > 0) {
      lastKnownCredits = creditsCents;
    }
  } catch {
    if (db) {
      const cached = db.getKV("last_known_balance");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return {
            creditsCents: parsed.creditsCents ?? 0,
            usdcBalance: parsed.usdcBalance ?? 0,
            lastChecked: new Date().toISOString(),
          };
        } catch {
          // ignore cache parse errors
        }
      }
    }
    return {
      creditsCents: -1,
      usdcBalance: -1,
      lastChecked: new Date().toISOString(),
    };
  }

  try {
    const network = chainType === "solana" ? "solana:mainnet" : "eip155:8453";
    usdcBalance = await getUsdcBalance(address, network, chainType as any);
    if (usdcBalance > 0) {
      lastKnownUsdc = usdcBalance;
    }
  } catch {
    // Ignore USDC read failures and keep cached value.
  }

  if (db) {
    db.setKV("last_known_balance", JSON.stringify({ creditsCents, usdcBalance }));
  }

  return {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };
}

function getWorklogPath(config: AutomatonConfig): string {
  const dbDir = path.dirname(
    config.dbPath.startsWith("~")
      ? path.join(process.env.HOME || "/root", config.dbPath.slice(1))
      : config.dbPath,
  );
  return path.join(dbDir, "WORKLOG.md");
}

function ensureWorklogExists(config: AutomatonConfig, db: AutomatonDatabase): void {
  const worklogPath = getWorklogPath(config);
  if (fs.existsSync(worklogPath)) return;

  const bootstrap = [
    "# WORKLOG",
    "",
    "## What This File Is",
    "This is the automaton's persistent working context.",
    "",
    "## Current Focus",
    "No persistent focus recorded yet.",
    "",
    "## Last Known Status",
    `Session ID: ${db.getKV("session_id") || "default"}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "## Last Progress",
    "- No progress recorded yet.",
    "",
    "## Next Best Step",
    "- Reconstruct current goal and continue from there.",
  ].join("\n");

  fs.writeFileSync(worklogPath, bootstrap, "utf-8");
}

function writePersistentWorklog(config: AutomatonConfig, db: AutomatonDatabase, turn: AgentTurn): void {
  const body = [
    "# WORKLOG",
    "",
    "## Current Focus",
    "Continue from the last successful turn.",
    "",
    "## Last Known Status",
    `Last Updated: ${new Date().toISOString()}`,
    `Agent State: ${db.getAgentState()}`,
    `Total Turns: ${db.getTurnCount()}`,
    "",
    "## Last Progress",
    `Last turn id: ${turn.id}`,
    `Last input source: ${turn.inputSource || "self"}`,
    `Last turn tokens: ${turn.tokenUsage.totalTokens}`,
    "",
    "### Last Thought",
    (turn.thinking || "No explicit reasoning captured.").slice(0, 800),
    "",
    "### Last Tool Results",
    turn.toolCalls.length > 0
      ? turn.toolCalls.map((toolCall) => `- ${toolCall.name}: ${toolCall.error ? `FAILED (${toolCall.error})` : "ok"}`).join("\n")
      : "- No tools called in the last turn.",
  ].join("\n");

  fs.writeFileSync(getWorklogPath(config), body, "utf-8");
}

function isMutatingTool(name: string): boolean {
  return new Set([
    "exec",
    "write_file",
    "transfer_credits",
    "expose_port",
    "remove_port",
  ]).has(name);
}

function normalizeToolCall(raw: unknown): { id: string; name: string; arguments: Record<string, unknown> } | null {
  if (!raw || typeof raw !== "object") return null;
  const anyRaw = raw as any;
  if (anyRaw.function && typeof anyRaw.function.name === "string") {
    return {
      id: anyRaw.id || randomUUID(),
      name: anyRaw.function.name,
      arguments: safeParseArgs(anyRaw.function.arguments),
    };
  }
  if (typeof anyRaw.name === "string") {
    return {
      id: anyRaw.id || randomUUID(),
      name: anyRaw.name,
      arguments: typeof anyRaw.arguments === "object" && anyRaw.arguments ? anyRaw.arguments : {},
    };
  }
  return null;
}

function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
