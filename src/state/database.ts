import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "fs";
import path from "path";
import type {
  AutomatonDatabase,
  AgentTurn,
  AgentState,
  ToolCallResult,
  HeartbeatEntry,
  Transaction,
  InstalledTool,
  ModificationEntry,
  Skill,
  ChildAutomaton,
  ChildStatus,
  RegistryEntry,
  ReputationEntry,
  InboxMessage,
  PolicyDecisionRow,
  SpendTrackingRow,
  SpendCategory,
  InferenceCostRow,
  ModelRegistryRow,
  InboxMessageRow,
  ChildLifecycleEventRow,
  ChildLifecycleState,
} from "../types.js";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema.js";

type DatabaseType = BetterSqlite3.Database;

export function createDatabase(dbPath: string): AutomatonDatabase {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_autocheckpoint = 1000");
  db.pragma("foreign_keys = ON");

  const integrity = db.pragma("integrity_check") as { integrity_check: string }[];
  if (integrity[0]?.integrity_check !== "ok") {
    throw new Error(`Database integrity check failed: ${JSON.stringify(integrity)}`);
  }

  const createSchema = db.transaction(() => {
    db.exec(CREATE_TABLES);
  });
  createSchema();

  const versionRow = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as { v: number | null } | undefined;
  const currentVersion = versionRow?.v ?? 0;
  if (currentVersion < SCHEMA_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, datetime('now'))",
    ).run(SCHEMA_VERSION);
  }

  const getIdentity = (key: string): string | undefined => {
    const row = db.prepare("SELECT value FROM identity WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  };

  const setIdentity = (key: string, value: string): void => {
    db.prepare("INSERT OR REPLACE INTO identity (key, value) VALUES (?, ?)").run(key, value);
  };

  const insertTurn = (turn: AgentTurn): void => {
    db.prepare(
      `INSERT INTO turns (id, timestamp, state, input, input_source, thinking, tool_calls, token_usage, cost_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      turn.id,
      turn.timestamp,
      turn.state,
      turn.input ?? null,
      turn.inputSource ?? null,
      turn.thinking,
      JSON.stringify(turn.toolCalls),
      JSON.stringify(turn.tokenUsage),
      turn.costCents,
    );
  };

  const getRecentTurns = (limit: number): AgentTurn[] => {
    const rows = db.prepare("SELECT * FROM turns ORDER BY timestamp DESC LIMIT ?").all(limit) as any[];
    return rows.map(deserializeTurn).reverse();
  };

  const getTurnById = (id: string): AgentTurn | undefined => {
    const row = db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as any | undefined;
    return row ? deserializeTurn(row) : undefined;
  };

  const getTurnCount = (): number => {
    const row = db.prepare("SELECT COUNT(*) as count FROM turns").get() as { count: number };
    return row.count;
  };

  const insertToolCall = (turnId: string, call: ToolCallResult): void => {
    db.prepare(
      `INSERT INTO tool_calls (id, turn_id, name, arguments, result, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      call.id,
      turnId,
      call.name,
      JSON.stringify(call.arguments),
      call.result,
      call.durationMs,
      call.error ?? null,
    );
  };

  const getToolCallsForTurn = (turnId: string): ToolCallResult[] => {
    const rows = db.prepare("SELECT * FROM tool_calls WHERE turn_id = ?").all(turnId) as any[];
    return rows.map(deserializeToolCall);
  };

  const getHeartbeatEntries = (): HeartbeatEntry[] => {
    const rows = db.prepare("SELECT * FROM heartbeat_entries").all() as any[];
    return rows.map(deserializeHeartbeatEntry);
  };

  const upsertHeartbeatEntry = (entry: HeartbeatEntry): void => {
    db.prepare(
      `INSERT OR REPLACE INTO heartbeat_entries (name, schedule, task, enabled, last_run, next_run, params, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      entry.name,
      entry.schedule,
      entry.task,
      entry.enabled ? 1 : 0,
      entry.lastRun ?? null,
      entry.nextRun ?? null,
      JSON.stringify(entry.params ?? {}),
    );
  };

  const updateHeartbeatLastRun = (name: string, timestamp: string): void => {
    db.prepare("UPDATE heartbeat_entries SET last_run = ?, updated_at = datetime('now') WHERE name = ?").run(timestamp, name);
  };

  const insertTransaction = (txn: Transaction): void => {
    db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, balance_after_cents, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      txn.id,
      txn.type,
      txn.amountCents ?? null,
      txn.balanceAfterCents ?? null,
      txn.description,
      txn.timestamp,
    );
  };

  const getRecentTransactions = (limit: number): Transaction[] => {
    const rows = db.prepare("SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map(deserializeTransaction).reverse();
  };

  const getInstalledTools = (): InstalledTool[] => {
    const rows = db.prepare("SELECT * FROM installed_tools WHERE enabled = 1").all() as any[];
    return rows.map(deserializeInstalledTool);
  };

  const installTool = (tool: InstalledTool): void => {
    db.prepare(
      `INSERT OR REPLACE INTO installed_tools (id, name, type, config, installed_at, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      tool.id,
      tool.name,
      tool.type,
      JSON.stringify(tool.config ?? {}),
      tool.installedAt,
      tool.enabled ? 1 : 0,
    );
  };

  const removeTool = (id: string): void => {
    db.prepare("UPDATE installed_tools SET enabled = 0 WHERE id = ?").run(id);
  };

  const insertModification = (mod: ModificationEntry): void => {
    db.prepare(
      `INSERT INTO modifications (id, timestamp, type, description, file_path, diff, reversible)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      mod.id,
      mod.timestamp,
      mod.type,
      mod.description,
      mod.filePath ?? null,
      mod.diff ?? null,
      mod.reversible ? 1 : 0,
    );
  };

  const getRecentModifications = (limit: number): ModificationEntry[] => {
    const rows = db.prepare("SELECT * FROM modifications ORDER BY timestamp DESC LIMIT ?").all(limit) as any[];
    return rows.map(deserializeModification).reverse();
  };

  const getKV = (key: string): string | undefined => {
    const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  };

  const setKV = (key: string, value: string): void => {
    db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
  };

  const deleteKV = (key: string): void => {
    db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  };

  const deleteKVReturning = (key: string): string | undefined => {
    const row = db.prepare("DELETE FROM kv WHERE key = ? RETURNING value").get(key) as { value: string } | undefined;
    return row?.value;
  };

  const getSkills = (enabledOnly?: boolean): Skill[] => {
    const query = enabledOnly ? "SELECT * FROM skills WHERE enabled = 1" : "SELECT * FROM skills";
    const rows = db.prepare(query).all() as any[];
    return rows.map(deserializeSkill);
  };

  const getSkillByName = (name: string): Skill | undefined => {
    const row = db.prepare("SELECT * FROM skills WHERE name = ?").get(name) as any | undefined;
    return row ? deserializeSkill(row) : undefined;
  };

  const upsertSkill = (skill: Skill): void => {
    db.prepare(
      `INSERT OR REPLACE INTO skills (name, description, auto_activate, requires, instructions, source, path, enabled, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      skill.name,
      skill.description,
      skill.autoActivate ? 1 : 0,
      JSON.stringify(skill.requires ?? {}),
      skill.instructions,
      skill.source,
      skill.path,
      skill.enabled ? 1 : 0,
      skill.installedAt,
    );
  };

  const removeSkill = (name: string): void => {
    db.prepare("UPDATE skills SET enabled = 0 WHERE name = ?").run(name);
  };

  const getChildren = (): ChildAutomaton[] => {
    const rows = db.prepare("SELECT * FROM children ORDER BY created_at DESC").all() as any[];
    return rows.map(deserializeChild);
  };

  const getChildById = (id: string): ChildAutomaton | undefined => {
    const row = db.prepare("SELECT * FROM children WHERE id = ?").get(id) as any | undefined;
    return row ? deserializeChild(row) : undefined;
  };

  const insertChild = (child: ChildAutomaton): void => {
    db.prepare(
      `INSERT INTO children (id, name, address, sandbox_id, genesis_prompt, creator_message, funded_amount_cents, status, created_at, last_checked, chain_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      child.id,
      child.name,
      child.address,
      child.sandboxId,
      child.genesisPrompt,
      child.creatorMessage ?? null,
      child.fundedAmountCents,
      child.status,
      child.createdAt,
      child.lastChecked ?? null,
      child.chainType ?? "evm",
    );
  };

  const updateChildStatus = (id: string, status: ChildStatus): void => {
    db.prepare("UPDATE children SET status = ?, last_checked = datetime('now') WHERE id = ?").run(status, id);
  };

  const getRegistryEntry = (): RegistryEntry | undefined => {
    const row = db.prepare("SELECT * FROM registry LIMIT 1").get() as any | undefined;
    return row ? deserializeRegistry(row) : undefined;
  };

  const setRegistryEntry = (entry: RegistryEntry): void => {
    db.prepare(
      `INSERT OR REPLACE INTO registry (agent_id, agent_uri, chain, contract_address, tx_hash, registered_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.agentId,
      entry.agentURI,
      entry.chain,
      entry.contractAddress,
      entry.txHash,
      entry.registeredAt,
    );
  };

  const insertReputation = (entry: ReputationEntry): void => {
    db.prepare(
      `INSERT INTO reputation (id, from_agent, to_agent, score, comment, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.id,
      entry.fromAgent,
      entry.toAgent,
      entry.score,
      entry.comment,
      entry.txHash ?? null,
      entry.createdAt,
    );
  };

  const getReputation = (agentAddress?: string): ReputationEntry[] => {
    const query = agentAddress
      ? "SELECT * FROM reputation WHERE to_agent = ? ORDER BY created_at DESC"
      : "SELECT * FROM reputation ORDER BY created_at DESC";
    const params = agentAddress ? [agentAddress] : [];
    const rows = db.prepare(query).all(...params) as any[];
    return rows.map(deserializeReputation);
  };

  const insertInboxMessage = (msg: InboxMessage): void => {
    db.prepare(
      `INSERT OR IGNORE INTO inbox_messages (id, from_address, content, received_at, reply_to)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.from,
      msg.content,
      msg.createdAt || new Date().toISOString(),
      msg.replyTo ?? null,
    );
  };

  const getUnprocessedInboxMessages = (limit: number): InboxMessage[] => {
    const rows = db.prepare(
      "SELECT * FROM inbox_messages WHERE processed_at IS NULL ORDER BY received_at ASC LIMIT ?",
    ).all(limit) as any[];
    return rows.map(deserializeInboxMessage);
  };

  const markInboxMessageProcessed = (id: string): void => {
    db.prepare("UPDATE inbox_messages SET processed_at = datetime('now') WHERE id = ?").run(id);
  };

  const getAgentState = (): AgentState => {
    return validateAgentState(getKV("agent_state"));
  };

  const setAgentState = (state: AgentState): void => {
    setKV("agent_state", state);
  };

  const runTransaction = <T>(fn: () => T): T => {
    const transaction = db.transaction(() => fn());
    return transaction();
  };

  const close = (): void => {
    db.close();
  };

  return {
    getIdentity,
    setIdentity,
    insertTurn,
    getRecentTurns,
    getTurnById,
    getTurnCount,
    insertToolCall,
    getToolCallsForTurn,
    getHeartbeatEntries,
    upsertHeartbeatEntry,
    updateHeartbeatLastRun,
    insertTransaction,
    getRecentTransactions,
    getInstalledTools,
    installTool,
    removeTool,
    insertModification,
    getRecentModifications,
    getKV,
    setKV,
    deleteKV,
    deleteKVReturning,
    getSkills,
    getSkillByName,
    upsertSkill,
    removeSkill,
    getChildren,
    getChildById,
    insertChild,
    updateChildStatus,
    getRegistryEntry,
    setRegistryEntry,
    insertReputation,
    getReputation,
    insertInboxMessage,
    getUnprocessedInboxMessages,
    markInboxMessageProcessed,
    getAgentState,
    setAgentState,
    runTransaction,
    close,
    raw: db,
  };
}

function deserializeTurn(row: any): AgentTurn {
  return {
    id: row.id,
    timestamp: row.timestamp,
    state: validateAgentState(row.state),
    input: row.input ?? undefined,
    inputSource: row.input_source ?? undefined,
    thinking: row.thinking,
    toolCalls: safeJsonParse(row.tool_calls, []),
    tokenUsage: safeJsonParse(row.token_usage, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }),
    costCents: row.cost_cents ?? 0,
  };
}

function deserializeToolCall(row: any): ToolCallResult {
  return {
    id: row.id,
    name: row.name,
    arguments: safeJsonParse(row.arguments, {}),
    result: row.result,
    durationMs: row.duration_ms ?? 0,
    error: row.error ?? undefined,
  };
}

function deserializeHeartbeatEntry(row: any): HeartbeatEntry {
  return {
    name: row.name,
    schedule: row.schedule,
    task: row.task,
    enabled: Boolean(row.enabled),
    lastRun: row.last_run ?? undefined,
    nextRun: row.next_run ?? undefined,
    params: safeJsonParse(row.params, {}),
  };
}

function deserializeTransaction(row: any): Transaction {
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amount_cents ?? undefined,
    balanceAfterCents: row.balance_after_cents ?? undefined,
    description: row.description,
    timestamp: row.created_at,
  };
}

function deserializeInstalledTool(row: any): InstalledTool {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: safeJsonParse(row.config, {}),
    installedAt: row.installed_at,
    enabled: Boolean(row.enabled),
  };
}

function deserializeModification(row: any): ModificationEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    description: row.description,
    filePath: row.file_path ?? undefined,
    diff: row.diff ?? undefined,
    reversible: Boolean(row.reversible),
  };
}

function deserializeSkill(row: any): Skill {
  return {
    name: row.name,
    description: row.description,
    autoActivate: Boolean(row.auto_activate),
    requires: safeJsonParse(row.requires, {}),
    instructions: row.instructions,
    source: row.source,
    path: row.path,
    enabled: Boolean(row.enabled),
    installedAt: row.installed_at,
  };
}

function deserializeChild(row: any): ChildAutomaton {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    sandboxId: row.sandbox_id,
    genesisPrompt: row.genesis_prompt,
    creatorMessage: row.creator_message ?? undefined,
    fundedAmountCents: row.funded_amount_cents ?? 0,
    status: row.status,
    createdAt: row.created_at,
    lastChecked: row.last_checked ?? undefined,
    chainType: row.chain_type ?? undefined,
  };
}

function deserializeRegistry(row: any): RegistryEntry {
  return {
    agentId: row.agent_id,
    agentURI: row.agent_uri,
    chain: row.chain,
    contractAddress: row.contract_address,
    txHash: row.tx_hash,
    registeredAt: row.registered_at,
  };
}

function deserializeReputation(row: any): ReputationEntry {
  return {
    id: row.id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    score: row.score,
    comment: row.comment,
    txHash: row.tx_hash ?? undefined,
    createdAt: row.created_at,
  };
}

function deserializeInboxMessage(row: any): InboxMessage {
  return {
    id: row.id,
    from: row.from_address,
    to: "",
    content: row.content,
    signedAt: row.received_at,
    createdAt: row.received_at,
    replyTo: row.reply_to ?? undefined,
  };
}

function validateAgentState(value: string | undefined): AgentState {
  const validStates: AgentState[] = [
    "setup",
    "waking",
    "running",
    "sleeping",
    "low_compute",
    "critical",
    "dead",
  ];

  if (value && validStates.includes(value as AgentState)) {
    return value as AgentState;
  }

  return "setup";
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function insertPolicyDecision(db: DatabaseType, row: PolicyDecisionRow): void {
  db.prepare(
    `INSERT INTO policy_decisions
      (id, turn_id, tool_name, tool_args_hash, risk_level, decision, rules_evaluated, rules_triggered, reason, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.turnId,
    row.toolName,
    row.toolArgsHash,
    row.riskLevel,
    row.decision,
    row.rulesEvaluated,
    row.rulesTriggered,
    row.reason,
    row.latencyMs,
  );
}

export function insertSpendRecord(db: DatabaseType, entry: SpendTrackingRow): void {
  db.prepare(
    `INSERT INTO spend_tracking
      (id, tool_name, amount_cents, recipient, domain, category, window_hour, window_day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.toolName,
    entry.amountCents,
    entry.recipient,
    entry.domain,
    entry.category,
    entry.windowHour,
    entry.windowDay,
  );
}

export function getSpendByWindow(
  db: DatabaseType,
  category: SpendCategory,
  windowType: "hour" | "day",
  windowValue: string,
): number {
  const column = windowType === "hour" ? "window_hour" : "window_day";
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) as total
       FROM spend_tracking
       WHERE category = ? AND ${column} = ?`,
    )
    .get(category, windowValue) as { total: number };
  return row.total;
}

export function pruneSpendRecords(db: DatabaseType, olderThan: string): number {
  const result = db
    .prepare("DELETE FROM spend_tracking WHERE created_at < ?")
    .run(olderThan);
  return result.changes;
}

export function deleteChild(db: DatabaseType, childId: string): void {
  db.prepare("DELETE FROM children WHERE id = ?").run(childId);
}

export function consumeNextWakeEvent(_db: DatabaseType): undefined {
  return undefined;
}

export function claimInboxMessages(db: DatabaseType, limit: number): InboxMessageRow[] {
  const rows = db
    .prepare(
      `SELECT id, from_address, content, received_at, reply_to
       FROM inbox_messages
       WHERE processed_at IS NULL
       ORDER BY received_at ASC
       LIMIT ?`,
    )
    .all(limit) as any[];

  return rows.map((row) => ({
    id: row.id,
    fromAddress: row.from_address,
    content: row.content,
    receivedAt: row.received_at,
    retryCount: 0,
    maxRetries: 3,
    replyTo: row.reply_to ?? undefined,
  }));
}

export function markInboxProcessed(db: DatabaseType, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  db.prepare(`UPDATE inbox_messages SET processed_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
}

export function markInboxFailed(db: DatabaseType, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  db.prepare(`UPDATE inbox_messages SET processed_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
}

export function resetInboxToReceived(_db: DatabaseType, _ids: string[]): void {
  // Minimal implementation: claimed rows are only marked processed after success,
  // so failures do not need an explicit reset step yet.
}

export type GoalStatus = "active" | "completed" | "failed" | "paused";
export type TaskGraphStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface GoalRow {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  strategy: string | null;
  expectedRevenueCents: number;
  actualRevenueCents: number;
  createdAt: string;
  deadline: string | null;
  completedAt: string | null;
}

export interface TaskGraphRow {
  id: string;
  parentId: string | null;
  goalId: string;
  title: string;
  description: string;
  status: TaskGraphStatus;
  assignedTo: string | null;
  agentRole: string | null;
  priority: number;
  dependencies: string[];
  result: unknown | null;
  estimatedCostCents: number;
  actualCostCents: number;
  maxRetries: number;
  retryCount: number;
  timeoutMs: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export function lifecycleInsertEvent(db: DatabaseType, row: ChildLifecycleEventRow): void {
  db.prepare(
    `INSERT INTO child_lifecycle_events (id, child_id, from_state, to_state, reason, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.childId,
    row.fromState,
    row.toState,
    row.reason,
    row.metadata,
    row.createdAt,
  );
}

export function lifecycleGetEvents(db: DatabaseType, childId: string): ChildLifecycleEventRow[] {
  const rows = db.prepare(
    "SELECT * FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at ASC",
  ).all(childId) as any[];
  return rows.map(deserializeLifecycleEventRow);
}

export function lifecycleGetLatestState(db: DatabaseType, childId: string): ChildLifecycleState | null {
  const row = db.prepare(
    "SELECT to_state FROM child_lifecycle_events WHERE child_id = ? ORDER BY created_at DESC LIMIT 1",
  ).get(childId) as { to_state: string } | undefined;
  return (row?.to_state as ChildLifecycleState) ?? null;
}

export function getChildrenByStatus(db: DatabaseType, status: string): any[] {
  return db.prepare("SELECT * FROM children WHERE status = ?").all(status) as any[];
}

export function updateChildStatus(db: DatabaseType, childId: string, status: string): void {
  db.prepare(
    "UPDATE children SET status = ?, last_checked = datetime('now') WHERE id = ?",
  ).run(status, childId);
}

export function withTransaction<T>(db: DatabaseType, fn: () => T): T {
  const tx = db.transaction(() => fn());
  return tx();
}

export function insertGoal(
  db: DatabaseType,
  row: {
    title: string;
    description: string;
    status?: GoalStatus;
    strategy?: string | null;
    expectedRevenueCents?: number;
    actualRevenueCents?: number;
    deadline?: string | null;
    completedAt?: string | null;
  },
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO goals (id, title, description, status, strategy, expected_revenue_cents, actual_revenue_cents, created_at, deadline, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.title,
    row.description,
    row.status ?? "active",
    row.strategy ?? null,
    row.expectedRevenueCents ?? 0,
    row.actualRevenueCents ?? 0,
    now,
    row.deadline ?? null,
    row.completedAt ?? null,
  );
  return id;
}

export function getGoalById(db: DatabaseType, id: string): GoalRow | undefined {
  const row = db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as any | undefined;
  return row ? deserializeGoalRow(row) : undefined;
}

export function updateGoalStatus(db: DatabaseType, id: string, status: GoalStatus): void {
  const completedAt = status === "completed" ? new Date().toISOString() : null;
  db.prepare("UPDATE goals SET status = ?, completed_at = ? WHERE id = ?").run(status, completedAt, id);
}

export function getActiveGoals(db: DatabaseType): GoalRow[] {
  const rows = db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at ASC").all() as any[];
  return rows.map(deserializeGoalRow);
}

export function insertTask(
  db: DatabaseType,
  row: {
    parentId?: string | null;
    goalId: string;
    title: string;
    description: string;
    status?: TaskGraphStatus;
    assignedTo?: string | null;
    agentRole?: string | null;
    priority?: number;
    dependencies?: string[];
    result?: unknown | null;
    estimatedCostCents?: number;
    actualCostCents?: number;
    maxRetries?: number;
    retryCount?: number;
    timeoutMs?: number;
    startedAt?: string | null;
    completedAt?: string | null;
  },
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO task_graph
     (id, parent_id, goal_id, title, description, status, assigned_to, agent_role, priority, dependencies, result, estimated_cost_cents, actual_cost_cents, max_retries, retry_count, timeout_ms, created_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
  ).run(
    id,
    row.parentId ?? null,
    row.goalId,
    row.title,
    row.description,
    row.status ?? "pending",
    row.assignedTo ?? null,
    row.agentRole ?? null,
    row.priority ?? 50,
    JSON.stringify(row.dependencies ?? []),
    row.result == null ? null : JSON.stringify(row.result),
    row.estimatedCostCents ?? 0,
    row.actualCostCents ?? 0,
    row.maxRetries ?? 3,
    row.retryCount ?? 0,
    row.timeoutMs ?? 300000,
    row.startedAt ?? null,
    row.completedAt ?? null,
  );
  return id;
}

export function getTaskById(db: DatabaseType, id: string): TaskGraphRow | undefined {
  const row = db.prepare("SELECT * FROM task_graph WHERE id = ?").get(id) as any | undefined;
  return row ? deserializeTaskGraphRow(row) : undefined;
}

export function getTasksByGoal(db: DatabaseType, goalId: string): TaskGraphRow[] {
  const rows = db.prepare(
    "SELECT * FROM task_graph WHERE goal_id = ? ORDER BY priority DESC, created_at ASC",
  ).all(goalId) as any[];
  return rows.map(deserializeTaskGraphRow);
}

export function getReadyTasks(db: DatabaseType): TaskGraphRow[] {
  const rows = db.prepare(
    `SELECT t.*
     FROM task_graph t
     WHERE t.status = 'pending'
       AND NOT EXISTS (
         SELECT 1
         FROM json_each(COALESCE(NULLIF(t.dependencies, ''), '[]')) dep
         LEFT JOIN task_graph d ON d.id = dep.value
         WHERE d.status IS NULL OR d.status != 'completed'
       )
     ORDER BY t.priority DESC, t.created_at ASC`,
  ).all() as any[];
  return rows.map(deserializeTaskGraphRow);
}

export function updateTaskStatus(db: DatabaseType, id: string, status: TaskGraphStatus): void {
  const now = new Date().toISOString();
  if (status === "running") {
    db.prepare(
      "UPDATE task_graph SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
    ).run(status, now, id);
    return;
  }
  if (status === "completed" || status === "failed" || status === "cancelled") {
    db.prepare(
      "UPDATE task_graph SET status = ?, completed_at = ? WHERE id = ?",
    ).run(status, now, id);
    return;
  }
  db.prepare("UPDATE task_graph SET status = ? WHERE id = ?").run(status, id);
}

export function insertEvent(
  db: DatabaseType,
  row: {
    type: string;
    agentAddress: string;
    goalId?: string | null;
    taskId?: string | null;
    content: string;
    tokenCount: number;
    compactedTo?: string | null;
  },
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO event_stream (id, type, agent_address, goal_id, task_id, content, token_count, compacted_to, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    id,
    row.type,
    row.agentAddress,
    row.goalId ?? null,
    row.taskId ?? null,
    row.content,
    row.tokenCount,
    row.compactedTo ?? null,
  );
  return id;
}

export function getRecentEvents(db: DatabaseType, agentAddress: string, limit: number = 50): any[] {
  return db.prepare(
    "SELECT * FROM event_stream WHERE agent_address = ? ORDER BY created_at DESC LIMIT ?",
  ).all(agentAddress, limit) as any[];
}

export function getEventsByGoal(db: DatabaseType, goalId: string): any[] {
  return db.prepare(
    "SELECT * FROM event_stream WHERE goal_id = ? ORDER BY created_at ASC",
  ).all(goalId) as any[];
}

export function getEventsByType(db: DatabaseType, type: string, since?: string): any[] {
  return since
    ? db.prepare(
        "SELECT * FROM event_stream WHERE type = ? AND created_at >= ? ORDER BY created_at ASC",
      ).all(type, since) as any[]
    : db.prepare(
        "SELECT * FROM event_stream WHERE type = ? ORDER BY created_at ASC",
      ).all(type) as any[];
}

function deserializeGoalRow(row: any): GoalRow {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    strategy: row.strategy ?? null,
    expectedRevenueCents: row.expected_revenue_cents ?? 0,
    actualRevenueCents: row.actual_revenue_cents ?? 0,
    createdAt: row.created_at,
    deadline: row.deadline ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function deserializeTaskGraphRow(row: any): TaskGraphRow {
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    goalId: row.goal_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assignedTo: row.assigned_to ?? null,
    agentRole: row.agent_role ?? null,
    priority: row.priority,
    dependencies: safeJsonParse(row.dependencies, [] as string[]),
    result: safeJsonParse(row.result, null as unknown | null),
    estimatedCostCents: row.estimated_cost_cents ?? 0,
    actualCostCents: row.actual_cost_cents ?? 0,
    maxRetries: row.max_retries ?? 3,
    retryCount: row.retry_count ?? 0,
    timeoutMs: row.timeout_ms ?? 300000,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

function deserializeLifecycleEventRow(row: any): ChildLifecycleEventRow {
  return {
    id: row.id,
    childId: row.child_id,
    fromState: row.from_state,
    toState: row.to_state,
    reason: row.reason ?? null,
    metadata: row.metadata ?? "{}",
    createdAt: row.created_at,
  };
}

export function inferenceInsertCost(
  db: DatabaseType,
  row: Omit<InferenceCostRow, "id" | "createdAt">,
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO inference_costs
      (id, session_id, turn_id, model, provider, input_tokens, output_tokens, cost_cents, latency_ms, tier, task_type, cache_hit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.sessionId,
    row.turnId,
    row.model,
    row.provider,
    row.inputTokens,
    row.outputTokens,
    row.costCents,
    row.latencyMs,
    row.tier,
    row.taskType,
    row.cacheHit ? 1 : 0,
  );
  return id;
}

export function inferenceGetSessionCosts(db: DatabaseType, sessionId: string): InferenceCostRow[] {
  const rows = db
    .prepare("SELECT * FROM inference_costs WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as any[];
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    model: row.model,
    provider: row.provider,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costCents: row.cost_cents,
    latencyMs: row.latency_ms,
    tier: row.tier,
    taskType: row.task_type,
    cacheHit: Boolean(row.cache_hit),
    createdAt: row.created_at,
  }));
}

export function inferenceGetDailyCost(db: DatabaseType, date?: string): number {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cents), 0) AS total
       FROM inference_costs
       WHERE substr(created_at, 1, 10) = ?`,
    )
    .get(targetDate) as { total: number };
  return row.total;
}

export function inferenceGetHourlyCost(db: DatabaseType): number {
  const windowHour = new Date().toISOString().slice(0, 13);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cents), 0) AS total
       FROM inference_costs
       WHERE substr(created_at, 1, 13) = ?`,
    )
    .get(windowHour) as { total: number };
  return row.total;
}

export function inferenceGetModelCosts(
  db: DatabaseType,
  model: string,
  days?: number,
): { totalCents: number; callCount: number } {
  if (days && days > 0) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(cost_cents), 0) AS total_cents, COUNT(*) AS call_count
         FROM inference_costs
         WHERE model = ? AND created_at >= ?`,
      )
      .get(model, cutoff) as { total_cents: number; call_count: number };
    return { totalCents: row.total_cents, callCount: row.call_count };
  }

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_cents), 0) AS total_cents, COUNT(*) AS call_count
       FROM inference_costs
       WHERE model = ?`,
    )
    .get(model) as { total_cents: number; call_count: number };
  return { totalCents: row.total_cents, callCount: row.call_count };
}

export function modelRegistryUpsert(db: DatabaseType, entry: ModelRegistryRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO model_registry
      (model_id, provider, display_name, tier_minimum, cost_per_1k_input, cost_per_1k_output, max_tokens, context_window, supports_tools, supports_vision, parameter_style, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.modelId,
    entry.provider,
    entry.displayName,
    entry.tierMinimum,
    entry.costPer1kInput,
    entry.costPer1kOutput,
    entry.maxTokens,
    entry.contextWindow,
    entry.supportsTools ? 1 : 0,
    entry.supportsVision ? 1 : 0,
    entry.parameterStyle,
    entry.enabled ? 1 : 0,
    entry.createdAt,
    entry.updatedAt,
  );
}

export function modelRegistryGet(db: DatabaseType, modelId: string): ModelRegistryRow | undefined {
  const row = db.prepare("SELECT * FROM model_registry WHERE model_id = ?").get(modelId) as any | undefined;
  return row ? deserializeModelRegistryRow(row) : undefined;
}

export function modelRegistryGetAll(db: DatabaseType): ModelRegistryRow[] {
  const rows = db.prepare("SELECT * FROM model_registry ORDER BY provider, model_id").all() as any[];
  return rows.map(deserializeModelRegistryRow);
}

export function modelRegistryGetAvailable(db: DatabaseType, tierMinimum?: string): ModelRegistryRow[] {
  if (tierMinimum) {
    const rows = db
      .prepare("SELECT * FROM model_registry WHERE enabled = 1 AND tier_minimum = ? ORDER BY provider, model_id")
      .all(tierMinimum) as any[];
    return rows.map(deserializeModelRegistryRow);
  }
  const rows = db
    .prepare("SELECT * FROM model_registry WHERE enabled = 1 ORDER BY provider, model_id")
    .all() as any[];
  return rows.map(deserializeModelRegistryRow);
}

export function modelRegistrySetEnabled(db: DatabaseType, modelId: string, enabled: boolean): void {
  db.prepare("UPDATE model_registry SET enabled = ?, updated_at = datetime('now') WHERE model_id = ?")
    .run(enabled ? 1 : 0, modelId);
}

function deserializeModelRegistryRow(row: any): ModelRegistryRow {
  return {
    modelId: row.model_id,
    provider: row.provider,
    displayName: row.display_name,
    tierMinimum: row.tier_minimum,
    costPer1kInput: row.cost_per_1k_input,
    costPer1kOutput: row.cost_per_1k_output,
    maxTokens: row.max_tokens,
    contextWindow: row.context_window,
    supportsTools: Boolean(row.supports_tools),
    supportsVision: Boolean(row.supports_vision),
    parameterStyle: row.parameter_style,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
