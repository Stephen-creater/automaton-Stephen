import type { ChatMessage } from "../types.js";
import {
  ProviderRegistry,
  type ModelTier,
  type ModelConfig,
  type ResolvedModel,
} from "./provider-registry.js";

const RETRYABLE_STATUS_CODES = new Set([429, 500, 503]);
const RETRY_BACKOFF_MS = [1000, 2000, 4000] as const;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
const CIRCUIT_BREAKER_DISABLE_MS = 5 * 60_000;

export interface UnifiedInferenceResult {
  content: string;
  toolCalls?: unknown[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    inputCostCredits: number;
    outputCostCredits: number;
    totalCostCredits: number;
  };
  metadata: {
    providerId: string;
    modelId: string;
    tier: ModelTier;
    latencyMs: number;
    retries: number;
    failedProviders: string[];
  };
}

interface SharedChatParams {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;
  responseFormat?: { type: "json_object" | "text" };
  stream?: boolean;
}

interface UnifiedChatParams extends SharedChatParams {
  tier: ModelTier;
}

interface UnifiedChatDirectParams extends SharedChatParams {
  providerId: string;
  modelId: string;
}

interface CircuitBreakerState {
  failures: number;
  disabledUntil: number;
}

interface AttemptResult {
  result: UnifiedInferenceResult;
  retries: number;
}

class ProviderAttemptError extends Error {
  readonly providerId: string;
  readonly retries: number;
  readonly retryable: boolean;
  readonly originalError: unknown;

  constructor(params: {
    providerId: string;
    retries: number;
    retryable: boolean;
    originalError: unknown;
  }) {
    super(params.originalError instanceof Error ? params.originalError.message : String(params.originalError));
    this.providerId = params.providerId;
    this.retries = params.retries;
    this.retryable = params.retryable;
    this.originalError = params.originalError;
  }
}

export class UnifiedInferenceClient {
  private readonly registry: ProviderRegistry;
  private readonly circuitBreaker = new Map<string, CircuitBreakerState>();

  constructor(registry: ProviderRegistry) {
    this.registry = registry;
  }

  async chat(params: UnifiedChatParams): Promise<UnifiedInferenceResult> {
    const candidates = this.registry.resolveCandidates(params.tier, false);
    if (candidates.length === 0) {
      throw new Error(`No providers available for tier '${params.tier}'`);
    }

    const failedProviders: string[] = [];
    let totalRetries = 0;

    for (const resolved of candidates) {
      if (this.isProviderCircuitOpen(resolved.provider.id)) {
        failedProviders.push(resolved.provider.id);
        continue;
      }

      try {
        const attempt = await this.executeWithRetries(resolved, params, params.tier);
        this.markProviderSuccess(resolved.provider.id);
        return {
          ...attempt.result,
          metadata: {
            ...attempt.result.metadata,
            retries: totalRetries + attempt.retries,
            failedProviders,
          },
        };
      } catch (error) {
        if (!(error instanceof ProviderAttemptError)) {
          throw error;
        }
        totalRetries += error.retries;
        failedProviders.push(resolved.provider.id);
        this.markProviderFailure(resolved.provider.id);
        if (!error.retryable) {
          throw this.unwrapError(error.originalError);
        }
      }
    }

    throw new Error(`All providers failed for tier '${params.tier}'. Failed providers: ${failedProviders.join(", ")}`);
  }

  async chatDirect(params: UnifiedChatDirectParams): Promise<UnifiedInferenceResult> {
    if (this.isProviderCircuitOpen(params.providerId)) {
      throw new Error(`Provider '${params.providerId}' circuit is open`);
    }

    const resolved = this.registry.getModel(params.providerId, params.modelId);
    try {
      const attempt = await this.executeWithRetries(resolved, params, resolved.model.tier);
      this.markProviderSuccess(params.providerId);
      return {
        ...attempt.result,
        metadata: {
          ...attempt.result.metadata,
          retries: attempt.retries,
          failedProviders: [],
        },
      };
    } catch (error) {
      if (!(error instanceof ProviderAttemptError)) {
        throw error;
      }
      this.markProviderFailure(params.providerId);
      throw this.unwrapError(error.originalError);
    }
  }

  private async executeWithRetries(
    resolved: ResolvedModel,
    params: SharedChatParams,
    requestedTier: ModelTier,
  ): Promise<AttemptResult> {
    let retries = 0;

    while (true) {
      try {
        const result = await this.executeSingleRequest(resolved, requestedTier, params);
        return { result, retries };
      } catch (error) {
        const retryable = this.isRetryableError(error);
        if (!retryable) {
          throw new ProviderAttemptError({
            providerId: resolved.provider.id,
            retries,
            retryable: false,
            originalError: error,
          });
        }
        if (retries >= RETRY_BACKOFF_MS.length) {
          throw new ProviderAttemptError({
            providerId: resolved.provider.id,
            retries,
            retryable: true,
            originalError: error,
          });
        }
        const delayMs = RETRY_BACKOFF_MS[retries];
        retries += 1;
        await sleep(delayMs);
      }
    }
  }

  private async executeSingleRequest(
    resolved: ResolvedModel,
    requestedTier: ModelTier,
    params: SharedChatParams,
  ): Promise<UnifiedInferenceResult> {
    const startedAt = Date.now();
    const payload = this.buildChatCompletionRequest(resolved.model.id, params);
    const apiKey = process.env[resolved.provider.apiKeyEnvVar] || "local-dev-key";
    const response = await fetch(`${resolved.provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = new Error(`Provider ${resolved.provider.id} failed with status ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }

    const completion = await response.json() as any;
    const choice = completion.choices?.[0];
    if (!choice?.message) {
      throw new Error(`No completion choice returned from provider '${resolved.provider.id}'`);
    }

    return this.buildUnifiedResult({
      providerId: resolved.provider.id,
      model: resolved.model,
      requestedTier,
      latencyMs: Date.now() - startedAt,
      content: extractText(choice.message.content),
      toolCalls: normalizeToolCalls(choice.message.tool_calls),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        totalTokens: completion.usage?.total_tokens ?? 0,
      },
    });
  }

  private buildChatCompletionRequest(modelId: string, params: SharedChatParams): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: modelId,
      messages: params.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      })),
    };

    if (params.temperature !== undefined) payload.temperature = params.temperature;
    if (params.maxTokens !== undefined) payload.max_tokens = params.maxTokens;
    if (params.tools && params.tools.length > 0) payload.tools = params.tools;
    if (params.toolChoice !== undefined) payload.tool_choice = params.toolChoice;
    if (params.responseFormat !== undefined) payload.response_format = params.responseFormat;
    return payload;
  }

  private buildUnifiedResult(params: {
    providerId: string;
    model: ModelConfig;
    requestedTier: ModelTier;
    latencyMs: number;
    content: string;
    toolCalls?: unknown[];
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }): UnifiedInferenceResult {
    const inputCostCredits = params.usage.inputTokens * params.model.costPerInputToken;
    const outputCostCredits = params.usage.outputTokens * params.model.costPerOutputToken;
    return {
      content: params.content,
      toolCalls: params.toolCalls,
      usage: params.usage,
      cost: {
        inputCostCredits,
        outputCostCredits,
        totalCostCredits: inputCostCredits + outputCostCredits,
      },
      metadata: {
        providerId: params.providerId,
        modelId: params.model.id,
        tier: params.requestedTier,
        latencyMs: params.latencyMs,
        retries: 0,
        failedProviders: [],
      },
    };
  }

  private isRetryableError(error: unknown): boolean {
    const status = typeof error === "object" && error && "status" in error ? Number((error as any).status) : undefined;
    return status !== undefined ? RETRYABLE_STATUS_CODES.has(status) : false;
  }

  private markProviderFailure(providerId: string): void {
    const state = this.circuitBreaker.get(providerId) ?? { failures: 0, disabledUntil: 0 };
    state.failures += 1;
    if (state.failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      state.disabledUntil = Date.now() + CIRCUIT_BREAKER_DISABLE_MS;
      state.failures = 0;
    }
    this.circuitBreaker.set(providerId, state);
  }

  private markProviderSuccess(providerId: string): void {
    this.circuitBreaker.delete(providerId);
  }

  private isProviderCircuitOpen(providerId: string): boolean {
    const state = this.circuitBreaker.get(providerId);
    if (!state) return false;
    if (state.disabledUntil <= Date.now()) {
      this.circuitBreaker.delete(providerId);
      return false;
    }
    return true;
  }

  private unwrapError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item === "object" && "text" in item ? String((item as any).text) : ""))
      .join("");
  }
  return "";
}

function normalizeToolCalls(toolCalls: unknown): unknown[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }
  return toolCalls;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
