import fs from "fs";
import path from "path";
import type { HeartbeatEntry, HeartbeatConfig, AutomatonDatabase } from "../types.js";
import { getAutomatonDir } from "../identity/wallet.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("heartbeat.config");
const USDC_TOPUP_ENTRY_NAME = "check_usdc_balance";
const USDC_TOPUP_FAST_SCHEDULE = "*/5 * * * *";
const USDC_TOPUP_OLD_SCHEDULE = "0 */12 * * *";

const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  entries: [
    { name: "heartbeat_ping", schedule: "*/15 * * * *", task: "heartbeat_ping", enabled: true },
    { name: "check_credits", schedule: "0 */6 * * *", task: "check_credits", enabled: true },
    { name: "check_usdc_balance", schedule: "*/5 * * * *", task: "check_usdc_balance", enabled: true },
    { name: "check_for_updates", schedule: "0 */4 * * *", task: "check_for_updates", enabled: true },
    { name: "health_check", schedule: "*/30 * * * *", task: "health_check", enabled: true },
    { name: "check_social_inbox", schedule: "*/2 * * * *", task: "check_social_inbox", enabled: true },
  ],
  defaultIntervalMs: 60_000,
  lowComputeMultiplier: 4,
};

export function loadHeartbeatConfig(configPath?: string): HeartbeatConfig {
  const filePath = configPath || path.join(getAutomatonDir(), "heartbeat.yml");

  if (!fs.existsSync(filePath)) {
    return DEFAULT_HEARTBEAT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return mergeWithDefaults(parseHeartbeatYaml(raw));
  } catch (error) {
    logger.error("Failed to parse heartbeat config", error instanceof Error ? error : undefined);
    return DEFAULT_HEARTBEAT_CONFIG;
  }
}

export function saveHeartbeatConfig(
  config: HeartbeatConfig,
  configPath?: string,
): void {
  const filePath = configPath || path.join(getAutomatonDir(), "heartbeat.yml");
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(filePath, renderHeartbeatYaml(config), { mode: 0o600 });
}

export function writeDefaultHeartbeatConfig(configPath?: string): void {
  saveHeartbeatConfig(DEFAULT_HEARTBEAT_CONFIG, configPath);
}

export function syncHeartbeatToDb(
  config: HeartbeatConfig,
  db: AutomatonDatabase,
): void {
  for (const entry of config.entries) {
    db.upsertHeartbeatEntry(entry);
  }
}

function parseHeartbeatYaml(raw: string): HeartbeatConfig {
  const lines = raw.split("\n");
  const entries: HeartbeatEntry[] = [];
  let current: Partial<HeartbeatEntry> | null = null;
  let defaultIntervalMs = DEFAULT_HEARTBEAT_CONFIG.defaultIntervalMs;
  let lowComputeMultiplier = DEFAULT_HEARTBEAT_CONFIG.lowComputeMultiplier;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("- name:")) {
      if (current?.name && current.schedule && current.task) {
        entries.push({
          name: current.name,
          schedule: current.schedule,
          task: current.task,
          enabled: current.enabled !== false,
          params: current.params,
        });
      }
      current = { name: trimmed.replace(/^- name:\s*/, "").trim() };
      continue;
    }

    if (current && trimmed.startsWith("schedule:")) {
      current.schedule = trimmed.replace(/^schedule:\s*/, "").replace(/^["']|["']$/g, "");
      continue;
    }
    if (current && trimmed.startsWith("task:")) {
      current.task = trimmed.replace(/^task:\s*/, "").trim();
      continue;
    }
    if (current && trimmed.startsWith("enabled:")) {
      current.enabled = trimmed.replace(/^enabled:\s*/, "").trim() !== "false";
      continue;
    }
    if (trimmed.startsWith("defaultIntervalMs:")) {
      defaultIntervalMs = Number(trimmed.replace(/^defaultIntervalMs:\s*/, "").trim()) || DEFAULT_HEARTBEAT_CONFIG.defaultIntervalMs;
      continue;
    }
    if (trimmed.startsWith("lowComputeMultiplier:")) {
      lowComputeMultiplier = Number(trimmed.replace(/^lowComputeMultiplier:\s*/, "").trim()) || DEFAULT_HEARTBEAT_CONFIG.lowComputeMultiplier;
    }
  }

  if (current?.name && current.schedule && current.task) {
    entries.push({
      name: current.name,
      schedule: current.schedule,
      task: current.task,
      enabled: current.enabled !== false,
      params: current.params,
    });
  }

  return {
    entries: entries.length > 0 ? entries : DEFAULT_HEARTBEAT_CONFIG.entries,
    defaultIntervalMs,
    lowComputeMultiplier,
  };
}

function mergeWithDefaults(config: HeartbeatConfig): HeartbeatConfig {
  const defaults = DEFAULT_HEARTBEAT_CONFIG.entries.map((entry) => ({ ...entry }));
  const defaultsByName = new Map(defaults.map((entry) => [entry.name, entry]));
  const mergedByName = new Map(defaultsByName);

  for (const entry of config.entries) {
    if (!entry?.name) continue;
    const fallback = defaultsByName.get(entry.name);
    mergedByName.set(entry.name, {
      ...(fallback || {}),
      ...entry,
      enabled: entry.enabled !== false,
      task: entry.task || fallback?.task || "",
      schedule: entry.schedule || fallback?.schedule || "",
    });
  }

  const fallbackTopup = defaultsByName.get(USDC_TOPUP_ENTRY_NAME);
  if (fallbackTopup) {
    const current = mergedByName.get(USDC_TOPUP_ENTRY_NAME) || fallbackTopup;
    const migratedSchedule = current.schedule?.trim() === USDC_TOPUP_OLD_SCHEDULE
      ? USDC_TOPUP_FAST_SCHEDULE
      : current.schedule || fallbackTopup.schedule;
    mergedByName.set(USDC_TOPUP_ENTRY_NAME, {
      ...fallbackTopup,
      ...current,
      task: current.task || fallbackTopup.task,
      schedule: migratedSchedule,
    });
  }

  const orderedDefaultEntries = defaults.map(
    (defaultEntry) => mergedByName.get(defaultEntry.name) || defaultEntry,
  );
  const knownNames = new Set(defaults.map((entry) => entry.name));
  const customEntries = [...mergedByName.values()].filter((entry) => !knownNames.has(entry.name));

  return {
    ...config,
    entries: [...orderedDefaultEntries, ...customEntries],
  };
}

function renderHeartbeatYaml(config: HeartbeatConfig): string {
  const lines = ["entries:"];
  for (const entry of config.entries) {
    lines.push(`  - name: ${entry.name}`);
    lines.push(`    schedule: "${entry.schedule}"`);
    lines.push(`    task: ${entry.task}`);
    lines.push(`    enabled: ${entry.enabled ? "true" : "false"}`);
  }
  lines.push(`defaultIntervalMs: ${config.defaultIntervalMs}`);
  lines.push(`lowComputeMultiplier: ${config.lowComputeMultiplier}`);
  lines.push("");
  return lines.join("\n");
}
