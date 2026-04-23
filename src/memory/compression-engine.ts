import { ContextManager } from "./context-manager.js";
import { EventStream } from "./event-stream.js";
import { KnowledgeStore } from "./knowledge-store.js";

export class CompressionEngine {
  constructor(
    readonly contextManager: ContextManager,
    readonly eventStream: EventStream,
    readonly knowledgeStore: KnowledgeStore,
    readonly inference: unknown,
  ) {}
}
