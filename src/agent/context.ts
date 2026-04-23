import type {
  ChatMessage,
  AgentTurn,
  InferenceClient,
  TokenBudget,
  MemoryRetrievalResult,
} from "../types.js";
import { DEFAULT_TOKEN_BUDGET } from "../types.js";
import { createTokenCounter } from "../memory/context-manager.js";

const MAX_CONTEXT_TURNS = 20;
export const MAX_TOOL_RESULT_SIZE = 10_000;

let tokenCounter: ReturnType<typeof createTokenCounter> | null = null;

export type { TokenBudget };
export { DEFAULT_TOKEN_BUDGET };

export function estimateTokens(text: string): number {
  const content = text ?? "";
  const legacyEstimate = Math.ceil(content.length / 4);

  try {
    if (!tokenCounter) {
      tokenCounter = createTokenCounter();
    }
    const counted = tokenCounter.countTokens(content);
    if (Number.isFinite(counted) && counted > 0) {
      return Math.max(counted, legacyEstimate);
    }
  } catch {
    // Fall back to a conservative estimate when token counting is unavailable.
  }

  return legacyEstimate;
}

export function truncateToolResult(
  result: string,
  maxSize: number = MAX_TOOL_RESULT_SIZE,
): string {
  if (result.length <= maxSize) {
    return result;
  }

  return `${result.slice(0, maxSize)}\n\n[TRUNCATED: ${result.length - maxSize} characters omitted]`;
}

function estimateTurnTokens(turn: AgentTurn): number {
  let total = 0;

  if (turn.input) {
    total += estimateTokens(turn.input);
  }

  if (turn.thinking) {
    total += estimateTokens(turn.thinking);
  }

  for (const toolCall of turn.toolCalls) {
    total += estimateTokens(JSON.stringify(toolCall.arguments));
    total += estimateTokens(toolCall.error ? `Error: ${toolCall.error}` : toolCall.result);
  }

  return total;
}

export function buildContextMessages(
  systemPrompt: string,
  recentTurns: AgentTurn[],
  pendingInput?: { content: string; source: string },
  options?: {
    budget?: TokenBudget;
    inference?: InferenceClient;
  },
): ChatMessage[] {
  const budget = options?.budget ?? DEFAULT_TOKEN_BUDGET;
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

  const turnTokens = recentTurns.map((turn) => ({
    turn,
    tokens: estimateTurnTokens(turn),
  }));

  const totalTurnTokens = turnTokens.reduce((sum, item) => sum + item.tokens, 0);

  let turnsToRender: AgentTurn[] = recentTurns;
  let summaryMessage: string | null = null;

  if (totalTurnTokens > budget.recentTurns && recentTurns.length > 1) {
    let recentTokenCount = 0;
    let splitIndex = recentTurns.length;

    for (let i = turnTokens.length - 1; i >= 0; i -= 1) {
      if (recentTokenCount + turnTokens[i].tokens > budget.recentTurns) {
        splitIndex = i + 1;
        break;
      }
      recentTokenCount += turnTokens[i].tokens;
      if (i === 0) {
        splitIndex = 0;
      }
    }

    if (splitIndex === 0) {
      splitIndex = 1;
    }
    if (splitIndex >= recentTurns.length) {
      splitIndex = Math.max(1, recentTurns.length - 1);
    }

    const oldTurns = recentTurns.slice(0, splitIndex);
    turnsToRender = recentTurns.slice(splitIndex);
    const oldSummaries = oldTurns.map((turn) => {
      const tools = turn.toolCalls
        .map((toolCall) => `${toolCall.name}(${toolCall.error ? "FAILED" : "ok"})`)
        .join(", ");
      return `[${turn.timestamp}] ${turn.inputSource || "self"}: ${turn.thinking.slice(0, 100)}${tools ? ` | tools: ${tools}` : ""}`;
    });
    summaryMessage = `Previous context summary (${oldTurns.length} turns compressed):\n${oldSummaries.join("\n")}`;
  }

  if (summaryMessage) {
    messages.push({
      role: "user",
      content: `[system] ${summaryMessage}`,
    });
  }

  for (const turn of turnsToRender) {
    if (turn.input) {
      messages.push({
        role: "user",
        content: `[${turn.inputSource || "system"}] ${turn.input}`,
      });
    }

    if (turn.thinking) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: turn.thinking,
      };

      if (turn.toolCalls.length > 0) {
        assistantMessage.tool_calls = turn.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.arguments),
          },
        }));
      }

      messages.push(assistantMessage);

      for (const toolCall of turn.toolCalls) {
        messages.push({
          role: "tool",
          content: truncateToolResult(toolCall.error ? `Error: ${toolCall.error}` : toolCall.result),
          tool_call_id: toolCall.id,
        });
      }
    }
  }

  const analysisWindow = recentTurns.slice(-5);
  if (analysisWindow.length >= 3) {
    const toolFrequency: Record<string, number> = {};
    for (const turn of analysisWindow) {
      for (const toolCall of turn.toolCalls) {
        toolFrequency[toolCall.name] = (toolFrequency[toolCall.name] || 0) + 1;
      }
    }

    const repeatedTools = Object.entries(toolFrequency)
      .filter(([, count]) => count >= 3)
      .map(([name]) => name);

    if (repeatedTools.length > 0) {
      messages.push({
        role: "user",
        content:
          `[system] WARNING: You have been calling ${repeatedTools.join(", ")} repeatedly in recent turns. ` +
          "You already have this information. Move on to building something concrete.",
      });
    }
  }

  if (pendingInput) {
    messages.push({
      role: "user",
      content: `[${pendingInput.source}] ${pendingInput.content}`,
    });
  }

  return messages;
}

export function trimContext(
  turns: AgentTurn[],
  maxTurns: number = MAX_CONTEXT_TURNS,
): AgentTurn[] {
  if (turns.length <= maxTurns) {
    return turns;
  }

  return turns.slice(-maxTurns);
}

export function formatMemoryBlock(memories: MemoryRetrievalResult): string {
  const sections: string[] = [];

  if (memories.workingMemory.length > 0) {
    sections.push("### Working Memory");
    for (const entry of memories.workingMemory) {
      sections.push(`- [${entry.contentType}] (p=${entry.priority.toFixed(1)}) ${entry.content}`);
    }
  }

  if (memories.episodicMemory.length > 0) {
    sections.push("### Recent History");
    for (const entry of memories.episodicMemory) {
      sections.push(`- [${entry.eventType}] ${entry.summary} (${entry.outcome || "neutral"})`);
    }
  }

  if (memories.semanticMemory.length > 0) {
    sections.push("### Known Facts");
    for (const entry of memories.semanticMemory) {
      sections.push(`- [${entry.category}/${entry.key}] ${entry.value}`);
    }
  }

  if (memories.proceduralMemory.length > 0) {
    sections.push("### Known Procedures");
    for (const entry of memories.proceduralMemory) {
      sections.push(
        `- ${entry.name}: ${entry.description} (${entry.steps.length} steps, ${entry.successCount}/${entry.successCount + entry.failureCount} success)`,
      );
    }
  }

  if (memories.relationships.length > 0) {
    sections.push("### Known Entities");
    for (const entry of memories.relationships) {
      sections.push(`- ${entry.entityName || entry.entityAddress}: ${entry.relationshipType} (trust: ${entry.trustScore.toFixed(1)})`);
    }
  }

  if (sections.length === 0) {
    return "";
  }

  return `## Memory (${memories.totalTokens} tokens)\n\n${sections.join("\n")}`;
}

export async function summarizeTurns(
  turns: AgentTurn[],
  inference: InferenceClient,
): Promise<string> {
  if (turns.length === 0) {
    return "No previous activity.";
  }

  const turnSummaries = turns.map((turn) => {
    const tools = turn.toolCalls
      .map((toolCall) => `${toolCall.name}(${toolCall.error ? "FAILED" : "ok"})`)
      .join(", ");
    return `[${turn.timestamp}] ${turn.inputSource || "self"}: ${turn.thinking.slice(0, 100)}${tools ? ` | tools: ${tools}` : ""}`;
  });

  if (turns.length <= 5) {
    return `Previous activity summary:\n${turnSummaries.join("\n")}`;
  }

  try {
    const response = await inference.chat(
      [
        {
          role: "system",
          content: "Summarize the following agent activity into a concise paragraph. Focus on what was accomplished, what failed, and what matters next.",
        },
        {
          role: "user",
          content: turnSummaries.join("\n"),
        },
      ],
      {
        maxTokens: 500,
        temperature: 0,
      },
    );

    return `Previous activity summary:\n${response.message.content}`;
  } catch {
    return `Previous activity summary:\n${turnSummaries.slice(-5).join("\n")}`;
  }
}
