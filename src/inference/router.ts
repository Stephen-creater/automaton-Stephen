import type BetterSqlite3 from "better-sqlite3";
import type {
  InferenceRequest,
  InferenceResult,
  ModelEntry,
  SurvivalTier,
  InferenceTaskType,
  ModelProvider,
  ChatMessage,
  ModelPreference,
} from "../types.js";
import { ModelRegistry } from "./registry.js";
import { InferenceBudgetTracker } from "./budget.js";
import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";

type Database = BetterSqlite3.Database;

export class InferenceRouter {
  private readonly db: Database;
  private readonly registry: ModelRegistry;
  private readonly budget: InferenceBudgetTracker;

  constructor(db: Database, registry: ModelRegistry, budget: InferenceBudgetTracker) {
    this.db = db;
    this.registry = registry;
    this.budget = budget;
  }

  async route(
    request: InferenceRequest,
    inferenceChat: (messages: ChatMessage[], options: Record<string, unknown>) => Promise<any>,
  ): Promise<InferenceResult> {
    const model = this.selectModel(request.tier, request.taskType);
    if (!model) {
      return {
        content: "",
        model: "none",
        provider: "other",
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "error",
      };
    }

    const preference = this.getPreference(request.tier, request.taskType);
    const maxTokens = request.maxTokens || preference?.maxTokens || model.maxTokens;
    const estimatedTokens = request.messages.reduce((sum, message) => sum + Math.ceil((message.content?.length || 0) / 4), 0);
    const estimatedCostCents = Math.ceil(
      (estimatedTokens / 1000) * model.costPer1kInput / 100 +
      (maxTokens / 1000) * model.costPer1kOutput / 100,
    );

    const budgetCheck = this.budget.checkBudget(estimatedCostCents, model.modelId);
    if (!budgetCheck.allowed) {
      return {
        content: `Budget exceeded: ${budgetCheck.reason}`,
        model: model.modelId,
        provider: model.provider,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "budget_exceeded",
      };
    }

    if (request.sessionId && this.budget.config.sessionBudgetCents > 0) {
      const sessionCost = this.budget.getSessionCost(request.sessionId);
      if (sessionCost + estimatedCostCents > this.budget.config.sessionBudgetCents) {
        return {
          content: `Session budget exceeded: ${sessionCost}c spent + ${estimatedCostCents}c estimated > ${this.budget.config.sessionBudgetCents}c limit`,
          model: model.modelId,
          provider: model.provider,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          latencyMs: 0,
          finishReason: "budget_exceeded",
        };
      }
    }

    const transformedMessages = this.transformMessagesForProvider(request.messages, model.provider);
    const timeout = TASK_TIMEOUTS[request.taskType] || 120_000;
    const startedAt = Date.now();

    try {
      const response = await withTimeout(
        inferenceChat(transformedMessages, {
          model: model.modelId,
          maxTokens,
          tools: request.tools,
        }),
        timeout,
      );
      const latencyMs = Date.now() - startedAt;
      const inputTokens = response.usage?.promptTokens ?? response.usage?.inputTokens ?? 0;
      const outputTokens = response.usage?.completionTokens ?? response.usage?.outputTokens ?? 0;
      const costCents = Math.ceil(
        (inputTokens / 1000) * model.costPer1kInput / 100 +
        (outputTokens / 1000) * model.costPer1kOutput / 100,
      );

      this.budget.recordCost({
        sessionId: request.sessionId ?? null,
        turnId: request.turnId ?? null,
        model: model.modelId,
        provider: model.provider,
        inputTokens,
        outputTokens,
        costCents,
        latencyMs,
        tier: request.tier,
        taskType: request.taskType,
        cacheHit: false,
      });

      return {
        content: response.message?.content ?? response.content ?? "",
        model: model.modelId,
        provider: model.provider,
        inputTokens,
        outputTokens,
        costCents,
        latencyMs,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason ?? "stop",
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      return {
        content: error instanceof Error ? error.message : String(error),
        model: model.modelId,
        provider: model.provider,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs,
        finishReason: "error",
      };
    }
  }

  selectModel(tier: SurvivalTier, taskType: InferenceTaskType): ModelEntry | null {
    const preference = this.getPreference(tier, taskType);
    if (preference) {
      for (const candidate of preference.candidates) {
        const model = this.registry.get(candidate);
        if (model && model.enabled) {
          return model;
        }
      }
    }

    const fallbackIds =
      tier === "critical" || tier === "dead"
        ? [this.budget.config.criticalModel, this.budget.config.inferenceModel, this.budget.config.lowComputeModel]
        : [this.budget.config.inferenceModel, this.budget.config.lowComputeModel, this.budget.config.criticalModel];

    for (const modelId of fallbackIds) {
      if (!modelId) continue;
      const model = this.registry.get(modelId);
      if (model && model.enabled) {
        return model;
      }
    }

    return null;
  }

  transformMessagesForProvider(messages: ChatMessage[], provider: ModelProvider): ChatMessage[] {
    if (provider === "anthropic") {
      return this.fixAnthropicMessages(messages);
    }
    return this.mergeConsecutiveSameRole(messages);
  }

  private fixAnthropicMessages(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const message of messages) {
      if (message.role === "system") {
        result.push(message);
        continue;
      }

      if (message.role === "tool") {
        const last = result[result.length - 1];
        const chunk = `[tool_result:${message.tool_call_id || "unknown"}] ${message.content}`;
        if (last && last.role === "user") {
          last.content = `${last.content}\n${chunk}`;
        } else {
          result.push({ role: "user", content: chunk });
        }
        continue;
      }

      const last = result[result.length - 1];
      if (last && last.role === message.role) {
        last.content = `${last.content}\n${message.content}`;
        if (message.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...message.tool_calls];
        }
        continue;
      }

      result.push({ ...message });
    }

    return result;
  }

  private mergeConsecutiveSameRole(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];
    for (const message of messages) {
      const last = result[result.length - 1];
      if (last && last.role === message.role && message.role !== "system" && message.role !== "tool") {
        last.content = `${last.content}\n${message.content}`;
        if (message.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...message.tool_calls];
        }
        continue;
      }
      result.push({ ...message });
    }
    return result;
  }

  private getPreference(tier: SurvivalTier, taskType: InferenceTaskType): ModelPreference | null {
    return DEFAULT_ROUTING_MATRIX[tier]?.[taskType] ?? null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Inference timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
