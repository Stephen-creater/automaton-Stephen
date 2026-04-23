import { ContextManager } from "./context-manager.js";
import { EventStream } from "./event-stream.js";
import { KnowledgeStore } from "./knowledge-store.js";
import type { ChatMessage } from "../types.js";

export class CompressionEngine {
  constructor(
    readonly contextManager: ContextManager,
    readonly eventStream: EventStream,
    readonly knowledgeStore: KnowledgeStore,
    readonly inference: unknown,
  ) {}

  compressContext(messages: ChatMessage[]): {
    messages: ChatMessage[];
    compressedCount: number;
  } {
    if (messages.length <= 8) {
      return { messages, compressedCount: 0 };
    }

    const systemMessages = messages.filter((message) => message.role === "system");
    const recentMessages = messages.slice(-6);
    const dropped = Math.max(0, messages.length - systemMessages.length - recentMessages.length);

    return {
      messages: [...systemMessages, ...recentMessages],
      compressedCount: dropped,
    };
  }
}
