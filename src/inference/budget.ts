import type BetterSqlite3 from "better-sqlite3";
import type { InferenceCostRow, ModelStrategyConfig } from "../types.js";
import {
  inferenceInsertCost,
  inferenceGetSessionCosts,
  inferenceGetDailyCost,
  inferenceGetHourlyCost,
  inferenceGetModelCosts,
} from "../state/database.js";

type Database = BetterSqlite3.Database;

export class InferenceBudgetTracker {
  private readonly db: Database;
  readonly config: ModelStrategyConfig;

  constructor(db: Database, config: ModelStrategyConfig) {
    this.db = db;
    this.config = config;
  }

  checkBudget(estimatedCostCents: number, _model: string): { allowed: boolean; reason?: string } {
    if (this.config.perCallCeilingCents > 0 && estimatedCostCents > this.config.perCallCeilingCents) {
      return {
        allowed: false,
        reason: `Per-call cost ${estimatedCostCents}c exceeds ceiling of ${this.config.perCallCeilingCents}c`,
      };
    }

    if (this.config.hourlyBudgetCents > 0) {
      const hourlyCost = this.getHourlyCost();
      if (hourlyCost + estimatedCostCents > this.config.hourlyBudgetCents) {
        return {
          allowed: false,
          reason: `Hourly budget exhausted: ${hourlyCost}c spent + ${estimatedCostCents}c estimated > ${this.config.hourlyBudgetCents}c limit`,
        };
      }
    }

    return { allowed: true };
  }

  recordCost(cost: Omit<InferenceCostRow, "id" | "createdAt">): void {
    inferenceInsertCost(this.db, cost);
  }

  getHourlyCost(): number {
    return inferenceGetHourlyCost(this.db);
  }

  getDailyCost(date?: string): number {
    return inferenceGetDailyCost(this.db, date);
  }

  getSessionCost(sessionId: string): number {
    return inferenceGetSessionCosts(this.db, sessionId).reduce((sum, item) => sum + item.costCents, 0);
  }

  getModelCosts(model: string, days?: number): { totalCents: number; callCount: number } {
    return inferenceGetModelCosts(this.db, model, days);
  }
}
