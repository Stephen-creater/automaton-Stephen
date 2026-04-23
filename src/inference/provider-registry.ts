import fs from "node:fs";

export type ModelTier = "reasoning" | "fast" | "cheap";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyEnvVar: string;
  models: ModelConfig[];
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  priority: number;
  enabled: boolean;
}

export interface ModelConfig {
  id: string;
  tier: ModelTier;
  contextWindow: number;
  maxOutputTokens: number;
  costPerInputToken: number;
  costPerOutputToken: number;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
}

export interface ResolvedModel {
  provider: ProviderConfig;
  model: ModelConfig;
}

interface TierDefault {
  preferredProvider: string;
  fallbackOrder: string[];
}

interface ProviderConfigFile {
  providers?: unknown;
  tierDefaults?: Partial<Record<ModelTier, Partial<TierDefault>>>;
  globalRateLimits?: {
    emergencyStopCredits?: number;
  };
}

const DEFAULT_TIER_DEFAULTS: Record<ModelTier, TierDefault> = {
  reasoning: { preferredProvider: "openai", fallbackOrder: ["local"] },
  fast: { preferredProvider: "openai", fallbackOrder: ["local"] },
  cheap: { preferredProvider: "local", fallbackOrder: ["openai"] },
};

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    models: [
      {
        id: "gpt-5.2",
        tier: "reasoning",
        contextWindow: 1047576,
        maxOutputTokens: 32768,
        costPerInputToken: 0.0018,
        costPerOutputToken: 0.014,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
      {
        id: "gpt-5-mini",
        tier: "fast",
        contextWindow: 1047576,
        maxOutputTokens: 16384,
        costPerInputToken: 0.0008,
        costPerOutputToken: 0.0032,
        supportsTools: true,
        supportsVision: true,
        supportsStreaming: true,
      },
    ],
    maxRequestsPerMinute: 500,
    maxTokensPerMinute: 2_000_000,
    priority: 1,
    enabled: true,
  },
  {
    id: "local",
    name: "Local",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnvVar: "LOCAL_API_KEY",
    models: [
      {
        id: "llama3.1:8b",
        tier: "cheap",
        contextWindow: 131072,
        maxOutputTokens: 4096,
        costPerInputToken: 0,
        costPerOutputToken: 0,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
      },
    ],
    maxRequestsPerMinute: 100,
    maxTokensPerMinute: 200000,
    priority: 10,
    enabled: false,
  },
];

export class ProviderRegistry {
  private readonly providers: ProviderConfig[];
  private readonly tierDefaults: Record<ModelTier, TierDefault>;

  constructor(
    providers: ProviderConfig[],
    tierDefaults: Record<ModelTier, TierDefault> = DEFAULT_TIER_DEFAULTS,
  ) {
    this.providers = providers.map((provider) => deepCloneProvider(provider)).sort((a, b) => a.priority - b.priority);
    this.tierDefaults = {
      reasoning: normalizeTierDefault(tierDefaults.reasoning, DEFAULT_TIER_DEFAULTS.reasoning),
      fast: normalizeTierDefault(tierDefaults.fast, DEFAULT_TIER_DEFAULTS.fast),
      cheap: normalizeTierDefault(tierDefaults.cheap, DEFAULT_TIER_DEFAULTS.cheap),
    };
  }

  overrideBaseUrl(providerId: string, baseUrl: string): void {
    const provider = this.providers.find((item) => item.id === providerId);
    if (provider) {
      provider.baseUrl = baseUrl;
    }
  }

  static fromConfig(configPath: string): ProviderRegistry {
    let providers = DEFAULT_PROVIDERS.map((provider) => deepCloneProvider(provider));
    let tierDefaults = DEFAULT_TIER_DEFAULTS;

    if (!fs.existsSync(configPath)) {
      return new ProviderRegistry(providers, tierDefaults);
    }

    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as ProviderConfigFile;
      const configuredProviders = normalizeProviders(raw.providers);
      if (configuredProviders.length > 0) {
        providers = configuredProviders;
      }
      if (raw.tierDefaults) {
        tierDefaults = {
          reasoning: normalizeTierDefault(raw.tierDefaults.reasoning, DEFAULT_TIER_DEFAULTS.reasoning),
          fast: normalizeTierDefault(raw.tierDefaults.fast, DEFAULT_TIER_DEFAULTS.fast),
          cheap: normalizeTierDefault(raw.tierDefaults.cheap, DEFAULT_TIER_DEFAULTS.cheap),
        };
      }
    } catch {
      // Keep defaults when config parsing fails.
    }

    return new ProviderRegistry(providers, tierDefaults);
  }

  resolveModel(tier: ModelTier, survivalMode = false): ResolvedModel {
    const candidates = this.resolveCandidates(tier, survivalMode);
    if (candidates.length === 0) {
      throw new Error(`No provider/model available for tier '${tier}'`);
    }
    return candidates[0];
  }

  resolveCandidates(tier: ModelTier, survivalMode = false): ResolvedModel[] {
    const effectiveTier = survivalMode && tier === "reasoning" ? "cheap" : tier;
    const providerOrder = this.getProviderOrderForTier(effectiveTier);
    const results: ResolvedModel[] = [];

    for (const providerId of providerOrder) {
      const provider = this.providers.find((item) => item.id === providerId && item.enabled);
      if (!provider) continue;
      const model = provider.models.find((item) => item.tier === effectiveTier) ?? provider.models[0];
      if (!model) continue;
      if (provider.id !== "local" && !process.env[provider.apiKeyEnvVar]) continue;
      results.push({ provider, model });
    }

    return results;
  }

  getModel(providerId: string, modelId: string): ResolvedModel {
    const provider = this.providers.find((item) => item.id === providerId && item.enabled);
    if (!provider) {
      throw new Error(`Provider '${providerId}' is not available`);
    }
    const model = provider.models.find((item) => item.id === modelId);
    if (!model) {
      throw new Error(`Model '${modelId}' not found on provider '${providerId}'`);
    }
    return { provider, model };
  }

  private getProviderOrderForTier(tier: ModelTier): string[] {
    const defaults = this.tierDefaults[tier];
    return [defaults.preferredProvider, ...defaults.fallbackOrder];
  }
}

function normalizeProviders(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value)) return [];
  const providers: ProviderConfig[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const provider = item as Record<string, unknown>;
    if (typeof provider.id !== "string" || typeof provider.name !== "string" || typeof provider.baseUrl !== "string") {
      continue;
    }
    providers.push({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKeyEnvVar: typeof provider.apiKeyEnvVar === "string" ? provider.apiKeyEnvVar : "OPENAI_API_KEY",
      models: Array.isArray(provider.models) ? provider.models as ModelConfig[] : [],
      maxRequestsPerMinute: typeof provider.maxRequestsPerMinute === "number" ? provider.maxRequestsPerMinute : 60,
      maxTokensPerMinute: typeof provider.maxTokensPerMinute === "number" ? provider.maxTokensPerMinute : 100000,
      priority: typeof provider.priority === "number" ? provider.priority : 100,
      enabled: provider.enabled !== false,
    });
  }
  return providers;
}

function normalizeTierDefault(value: Partial<TierDefault> | undefined, fallback: TierDefault): TierDefault {
  return {
    preferredProvider: value?.preferredProvider || fallback.preferredProvider,
    fallbackOrder: Array.isArray(value?.fallbackOrder) ? value!.fallbackOrder!.filter((item): item is string => typeof item === "string") : fallback.fallbackOrder,
  };
}

function deepCloneProvider(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    models: provider.models.map((model) => ({ ...model })),
  };
}
