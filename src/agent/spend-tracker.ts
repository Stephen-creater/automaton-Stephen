import { randomUUID } from "crypto";
import type Database from "better-sqlite3";
import type {
  SpendTrackerInterface,
  SpendEntry,
  SpendCategory,
  TreasuryPolicy,
  LimitCheckResult,
  SpendTrackingRow,
} from "../types.js";
import {
  insertSpendRecord,
  getSpendByWindow,
  pruneSpendRecords,
} from "../state/database.js";

function getCurrentHourWindow(): string {
  return new Date().toISOString().slice(0, 13);
}

function getCurrentDayWindow(): string {
  return new Date().toISOString().slice(0, 10);
}

export class SpendTracker implements SpendTrackerInterface {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  recordSpend(entry: SpendEntry): void {
    const row: SpendTrackingRow = {
      id: randomUUID(),
      toolName: entry.toolName,
      amountCents: entry.amountCents,
      recipient: entry.recipient ?? null,
      domain: entry.domain ?? null,
      category: entry.category,
      windowHour: getCurrentHourWindow(),
      windowDay: getCurrentDayWindow(),
    };
    insertSpendRecord(this.db, row);
  }

  getHourlySpend(category: SpendCategory): number {
    return getSpendByWindow(this.db, category, "hour", getCurrentHourWindow());
  }

  getDailySpend(category: SpendCategory): number {
    return getSpendByWindow(this.db, category, "day", getCurrentDayWindow());
  }

  getTotalSpend(category: SpendCategory, since: Date): number {
    const sinceStr = since.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) as total
         FROM spend_tracking
         WHERE category = ? AND created_at >= ?`,
      )
      .get(category, sinceStr) as { total: number };
    return row.total;
  }

  checkLimit(
    amount: number,
    category: SpendCategory,
    limits: TreasuryPolicy,
  ): LimitCheckResult {
    const currentHourlySpend = this.getHourlySpend(category);
    const currentDailySpend = this.getDailySpend(category);

    let limitHourly: number;
    let limitDaily: number;

    if (category === "transfer") {
      limitHourly = limits.maxHourlyTransferCents;
      limitDaily = limits.maxDailyTransferCents;
    } else if (category === "x402") {
      limitHourly = limits.maxX402PaymentCents * 10;
      limitDaily = limits.maxX402PaymentCents * 50;
    } else {
      limitHourly = Math.ceil(limits.maxInferenceDailyCents / 6);
      limitDaily = limits.maxInferenceDailyCents;
    }

    if (currentHourlySpend + amount > limitHourly) {
      return {
        allowed: false,
        reason: `Hourly spend cap exceeded: current ${currentHourlySpend} + ${amount} > ${limitHourly}`,
        currentHourlySpend,
        currentDailySpend,
        limitHourly,
        limitDaily,
      };
    }

    if (currentDailySpend + amount > limitDaily) {
      return {
        allowed: false,
        reason: `Daily spend cap exceeded: current ${currentDailySpend} + ${amount} > ${limitDaily}`,
        currentHourlySpend,
        currentDailySpend,
        limitHourly,
        limitDaily,
      };
    }

    return {
      allowed: true,
      currentHourlySpend,
      currentDailySpend,
      limitHourly,
      limitDaily,
    };
  }

  pruneOldRecords(retentionDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    return pruneSpendRecords(this.db, cutoffStr);
  }
}
