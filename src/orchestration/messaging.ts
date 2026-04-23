import type { AutomatonDatabase, InboxMessage } from "../types.js";
import { insertEvent } from "../state/database.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("orchestration.messaging");
const MAX_INBOX_BATCH = 200;

export type MessageType =
  | "task_assignment"
  | "task_result"
  | "status_report"
  | "resource_request"
  | "knowledge_share"
  | "alert"
  | "shutdown_request";

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string;
  goalId: string | null;
  taskId: string | null;
  content: string;
  priority: "low" | "normal" | "high" | "critical";
  requiresResponse: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface ProcessedMessage {
  message: AgentMessage;
  handledBy: string;
  success: boolean;
  error?: string;
}

export interface MessageTransport {
  deliver(to: string, envelope: string): Promise<void>;
  getRecipients(): string[];
}

export class LocalDBTransport implements MessageTransport {
  constructor(private readonly db: AutomatonDatabase) {}

  async deliver(to: string, envelope: string): Promise<void> {
    this.db.insertInboxMessage({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      from: this.db.getIdentity("address") ?? "unknown",
      to,
      content: envelope,
      signedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }

  getRecipients(): string[] {
    return this.db.getChildren().map((child) => child.address);
  }
}

export class ColonyMessaging {
  constructor(
    private readonly transport: MessageTransport,
    private readonly db: AutomatonDatabase,
  ) {}

  async send(message: AgentMessage): Promise<void> {
    const envelope = JSON.stringify({
      protocol: "colony_message_v1",
      sentAt: new Date().toISOString(),
      message,
    });
    await this.transport.deliver(message.to, envelope);
    insertEvent(this.db.raw, {
      type: "action",
      agentAddress: message.from,
      goalId: message.goalId,
      taskId: message.taskId,
      content: `sent:${message.type}:${message.to}`,
      tokenCount: message.content.length,
    });
  }

  async processInbox(): Promise<ProcessedMessage[]> {
    const rows = this.db.getUnprocessedInboxMessages(MAX_INBOX_BATCH);
    const processed: ProcessedMessage[] = [];

    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.content) as { message?: AgentMessage };
        if (!parsed.message) throw new Error("Missing message envelope");
        processed.push({
          message: parsed.message,
          handledBy: "routeMessage",
          success: true,
        });
      } catch (error) {
        processed.push({
          message: createRejectedMessage(row),
          handledBy: "rejectMalformedMessage",
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.db.markInboxMessageProcessed(row.id);
      }
    }

    return processed;
  }

  async broadcast(content: string, priority: "high" | "critical"): Promise<void> {
    const recipients = this.transport.getRecipients();
    const from = this.db.getIdentity("address") ?? "unknown";
    await Promise.all(
      recipients.map((to) =>
        this.send({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          type: "alert",
          from,
          to,
          goalId: null,
          taskId: null,
          content,
          priority,
          requiresResponse: false,
          expiresAt: null,
          createdAt: new Date().toISOString(),
        }),
      ),
    );
  }
}

function createRejectedMessage(row: InboxMessage): AgentMessage {
  return {
    id: row.id,
    type: "alert",
    from: row.from,
    to: row.to,
    goalId: null,
    taskId: row.replyTo ?? null,
    content: row.content,
    priority: "low",
    requiresResponse: false,
    expiresAt: null,
    createdAt: row.createdAt,
  };
}
