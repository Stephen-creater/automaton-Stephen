import type BetterSqlite3 from "better-sqlite3";
import type { AgentTurn, ToolCallResult, SemanticCategory } from "../types.js";
import { WorkingMemoryManager } from "./working.js";
import { EpisodicMemoryManager } from "./episodic.js";
import { SemanticMemoryManager } from "./semantic.js";
import { RelationshipMemoryManager } from "./relationship.js";
import { classifyTurn } from "./types.js";
import { EventStream, estimateTokens } from "./event-stream.js";
import { KnowledgeStore, type KnowledgeCategory } from "./knowledge-store.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("memory.ingestion");
type Database = BetterSqlite3.Database;

export class MemoryIngestionPipeline {
  private readonly working: WorkingMemoryManager;
  private readonly episodic: EpisodicMemoryManager;
  private readonly semantic: SemanticMemoryManager;
  private readonly relationships: RelationshipMemoryManager;
  private readonly knowledgeStore: KnowledgeStore;
  private readonly eventStream: EventStream;

  constructor(private readonly db: Database) {
    this.working = new WorkingMemoryManager(db);
    this.episodic = new EpisodicMemoryManager(db);
    this.semantic = new SemanticMemoryManager(db);
    this.relationships = new RelationshipMemoryManager(db);
    this.knowledgeStore = new KnowledgeStore(db);
    this.eventStream = new EventStream(db);
  }

  ingest(sessionId: string, turn: AgentTurn, toolCallResults: ToolCallResult[]): void {
    try {
      const classification = classifyTurn(toolCallResults, turn.thinking);

      this.episodic.record({
        sessionId,
        eventType: turn.inputSource || "system",
        summary: summarizeTurn(turn, toolCallResults),
        detail: turn.thinking || null,
        outcome: toolCallResults.some((toolCall) => toolCall.error) ? "failure" : "success",
        importance: classification === "strategic" ? 0.9 : classification === "productive" ? 0.7 : 0.4,
        classification,
      });

      if (turn.input) {
        this.eventStream.append({
          type: "user_input",
          agentAddress: "self",
          goalId: null,
          taskId: null,
          content: turn.input,
          tokenCount: estimateTokens(turn.input),
          compactedTo: null,
        });
      }

      if (turn.thinking) {
        this.working.add({
          sessionId,
          content: turn.thinking.slice(0, 400),
          contentType: "reflection",
          priority: classification === "strategic" ? 0.9 : 0.5,
          sourceTurn: turn.id,
        });
      }

      for (const toolCall of toolCallResults) {
        if (toolCall.error) {
          this.episodic.record({
            sessionId,
            eventType: "tool_error",
            summary: `${toolCall.name} failed`,
            detail: toolCall.error,
            outcome: "failure",
            importance: 0.8,
            classification: "error",
          });
        }
      }

      this.extractSemanticFacts(toolCallResults);
      this.extractRelationships(toolCallResults);

      this.working.prune(sessionId, 20);
      this.episodic.prune(30);
      this.semantic.prune(500);
      this.knowledgeStore.prune();
    } catch (error) {
      logger.error("Ingestion failed", error instanceof Error ? error : undefined);
    }
  }

  private extractSemanticFacts(toolCalls: ToolCallResult[]): void {
    for (const toolCall of toolCalls) {
      if (!toolCall.result || toolCall.error) continue;

      if (toolCall.name === "check_credits") {
        this.semantic.store({
          category: "financial",
          key: "credits_status",
          value: toolCall.result,
          confidence: 0.9,
          source: toolCall.name,
        });
      }

      if (toolCall.name === "search_domains") {
        this.knowledgeStore.add({
          category: "market" as KnowledgeCategory,
          key: `domain-search:${Date.now()}`,
          content: toolCall.result,
          source: toolCall.name,
          confidence: 0.7,
          lastVerified: new Date().toISOString(),
          tokenCount: estimateTokens(toolCall.result),
          expiresAt: null,
        });
      }
    }
  }

  private extractRelationships(toolCalls: ToolCallResult[]): void {
    for (const toolCall of toolCalls) {
      const address = toolCall.arguments["to_address"];
      if (typeof address === "string") {
        this.relationships.record({
          entityAddress: address,
          relationshipType: "counterparty",
          trustScore: toolCall.error ? 0.4 : 0.6,
          notes: toolCall.name,
        });
        this.relationships.recordInteraction(address);
      }
    }
  }
}

function summarizeTurn(turn: AgentTurn, toolCalls: ToolCallResult[]): string {
  if (toolCalls.length === 0) {
    return turn.thinking.slice(0, 180) || "No tool activity recorded.";
  }
  const toolSummary = toolCalls.map((toolCall) => toolCall.name).join(", ");
  return `${turn.inputSource || "system"} turn used tools: ${toolSummary}`;
}
