import type BetterSqlite3 from "better-sqlite3";
import type { ModelEntry, ModelRegistryRow } from "../types.js";
import { STATIC_MODEL_BASELINE } from "./types.js";
import {
  modelRegistryUpsert,
  modelRegistryGet,
  modelRegistryGetAll,
  modelRegistryGetAvailable,
  modelRegistrySetEnabled,
} from "../state/database.js";

type Database = BetterSqlite3.Database;

export class ModelRegistry {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  initialize(): void {
    const now = new Date().toISOString();
    for (const model of STATIC_MODEL_BASELINE) {
      const existing = modelRegistryGet(this.db, model.modelId);
      const row: ModelRegistryRow = {
        modelId: model.modelId,
        provider: model.provider,
        displayName: model.displayName,
        tierMinimum: model.tierMinimum,
        costPer1kInput: model.costPer1kInput,
        costPer1kOutput: model.costPer1kOutput,
        maxTokens: model.maxTokens,
        contextWindow: model.contextWindow,
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        parameterStyle: model.parameterStyle,
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      modelRegistryUpsert(this.db, row);
    }
  }

  get(modelId: string): ModelEntry | undefined {
    const row = modelRegistryGet(this.db, modelId);
    return row ? this.rowToEntry(row) : undefined;
  }

  getAll(): ModelEntry[] {
    return modelRegistryGetAll(this.db).map((row) => this.rowToEntry(row));
  }

  getAvailable(tierMinimum?: string): ModelEntry[] {
    return modelRegistryGetAvailable(this.db, tierMinimum).map((row) => this.rowToEntry(row));
  }

  upsert(entry: ModelEntry): void {
    modelRegistryUpsert(this.db, {
      modelId: entry.modelId,
      provider: entry.provider,
      displayName: entry.displayName,
      tierMinimum: entry.tierMinimum,
      costPer1kInput: entry.costPer1kInput,
      costPer1kOutput: entry.costPer1kOutput,
      maxTokens: entry.maxTokens,
      contextWindow: entry.contextWindow,
      supportsTools: entry.supportsTools,
      supportsVision: entry.supportsVision,
      parameterStyle: entry.parameterStyle,
      enabled: entry.enabled,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }

  setEnabled(modelId: string, enabled: boolean): void {
    modelRegistrySetEnabled(this.db, modelId, enabled);
  }

  refreshFromApi(models: Array<Record<string, unknown>>): void {
    const now = new Date().toISOString();
    for (const model of models) {
      const modelId = String(model.id ?? "");
      if (!modelId) continue;
      const existing = modelRegistryGet(this.db, modelId);
      modelRegistryUpsert(this.db, {
        modelId,
        provider: String(model.provider ?? model.owned_by ?? existing?.provider ?? "other"),
        displayName: String(model.display_name ?? existing?.displayName ?? modelId),
        tierMinimum: String(existing?.tierMinimum ?? "normal"),
        costPer1kInput: Number((model as any).pricing?.input_per_1k ?? existing?.costPer1kInput ?? 0),
        costPer1kOutput: Number((model as any).pricing?.output_per_1k ?? existing?.costPer1kOutput ?? 0),
        maxTokens: Number(model.max_tokens ?? existing?.maxTokens ?? 4096),
        contextWindow: Number(model.context_window ?? existing?.contextWindow ?? 128000),
        supportsTools: Boolean(model.supports_tools ?? existing?.supportsTools ?? true),
        supportsVision: Boolean(model.supports_vision ?? existing?.supportsVision ?? false),
        parameterStyle: String(model.parameter_style ?? existing?.parameterStyle ?? "max_tokens"),
        enabled: existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
    }
  }

  getCostPer1k(modelId: string): { input: number; output: number } {
    const model = this.get(modelId);
    if (!model) {
      return { input: 0, output: 0 };
    }
    return { input: model.costPer1kInput, output: model.costPer1kOutput };
  }

  private rowToEntry(row: ModelRegistryRow): ModelEntry {
    return {
      modelId: row.modelId,
      provider: row.provider as ModelEntry["provider"],
      displayName: row.displayName,
      tierMinimum: row.tierMinimum as ModelEntry["tierMinimum"],
      costPer1kInput: row.costPer1kInput,
      costPer1kOutput: row.costPer1kOutput,
      maxTokens: row.maxTokens,
      contextWindow: row.contextWindow,
      supportsTools: row.supportsTools,
      supportsVision: row.supportsVision,
      parameterStyle: row.parameterStyle as ModelEntry["parameterStyle"],
      enabled: row.enabled,
      lastSeen: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
