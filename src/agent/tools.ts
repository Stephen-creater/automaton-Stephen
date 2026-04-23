import nodePath from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AutomatonTool,
  ToolContext,
  InferenceToolDefinition,
  ToolCallResult,
  PolicyRequest,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import { sanitizeToolResult, sanitizeInput } from "./injection-defense.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("tools");
const SANDBOX_HOME = "/root";

function confinePathToSandbox(filePath: string): string | { error: string } {
  const expanded = filePath.startsWith("~")
    ? nodePath.join(SANDBOX_HOME, filePath.slice(1))
    : filePath;
  const resolved = nodePath.resolve(SANDBOX_HOME, expanded);
  if (resolved !== SANDBOX_HOME && !resolved.startsWith(`${SANDBOX_HOME}/`)) {
    return {
      error: `Blocked: write_file path "${filePath}" resolves outside ${SANDBOX_HOME}.`,
    };
  }
  return resolved;
}

function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const EXTERNAL_SOURCE_TOOLS = new Set(["exec", "read_file"]);

export function createBuiltinTools(sandboxId: string): AutomatonTool[] {
  return [
    {
      name: "exec",
      description: "Execute a shell command in your sandbox.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in milliseconds" },
        },
        required: ["command"],
      },
      execute: async (args, ctx) => {
        const result = await ctx.conway.exec(
          args.command as string,
          (args.timeout as number) || 30_000,
        );
        return `exit_code: ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
      },
    },
    {
      name: "write_file",
      description: "Write content to a file inside the sandbox home.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
      execute: async (args, ctx) => {
        const confined = confinePathToSandbox(args.path as string);
        if (typeof confined === "object") {
          return confined.error;
        }
        await ctx.conway.writeFile(confined, args.content as string);
        return `File written: ${confined}`;
      },
    },
    {
      name: "read_file",
      description: "Read content from a file in the sandbox.",
      category: "vm",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read" },
        },
        required: ["path"],
      },
      execute: async (args, ctx) => {
        const filePath = args.path as string;
        try {
          return await ctx.conway.readFile(filePath);
        } catch {
          const result = await ctx.conway.exec(`cat ${escapeShellArg(filePath)}`, 30_000);
          if (result.exitCode !== 0) {
            return `ERROR: File not found or not readable: ${filePath}`;
          }
          return result.stdout;
        }
      },
    },
    {
      name: "expose_port",
      description: "Expose a sandbox port to the internet.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          port: { type: "number", description: "Port number" },
        },
        required: ["port"],
      },
      execute: async (args, ctx) => {
        const info = await ctx.conway.exposePort(args.port as number);
        return `Port ${info.port} exposed at: ${info.publicUrl}`;
      },
    },
    {
      name: "remove_port",
      description: "Remove a previously exposed port.",
      category: "vm",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          port: { type: "number", description: "Port number" },
        },
        required: ["port"],
      },
      execute: async (args, ctx) => {
        await ctx.conway.removePort(args.port as number);
        return `Port ${args.port as number} removed`;
      },
    },
    {
      name: "check_credits",
      description: "Check current Conway compute credits.",
      category: "conway",
      riskLevel: "safe",
      parameters: { type: "object", properties: {} },
      execute: async (_args, ctx) => {
        const balance = await ctx.conway.getCreditsBalance();
        return `Credit balance: $${(balance / 100).toFixed(2)} (${balance} cents)`;
      },
    },
    {
      name: "list_sandboxes",
      description: "List all Conway sandboxes.",
      category: "conway",
      riskLevel: "safe",
      parameters: { type: "object", properties: {} },
      execute: async (_args, ctx) => {
        const sandboxes = await ctx.conway.listSandboxes();
        if (sandboxes.length === 0) {
          return "No sandboxes found.";
        }
        return sandboxes
          .map((sandbox) => `${sandbox.id} [${sandbox.status}] ${sandbox.vcpu}vCPU/${sandbox.memoryMb}MB ${sandbox.region}`)
          .join("\n");
      },
    },
    {
      name: "transfer_credits",
      description: "Transfer Conway credits to another address.",
      category: "financial",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          to_address: { type: "string", description: "Recipient address" },
          amount_cents: { type: "number", description: "Amount in cents" },
          note: { type: "string", description: "Optional note" },
        },
        required: ["to_address", "amount_cents"],
      },
      execute: async (args, ctx) => {
        const result = await ctx.conway.transferCredits(
          args.to_address as string,
          args.amount_cents as number,
          args.note as string | undefined,
        );
        return `Transfer ${result.status}: ${result.amountCents} cents -> ${result.toAddress}`;
      },
    },
    {
      name: "search_domains",
      description: "Search for available domains.",
      category: "conway",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          tlds: { type: "string", description: "Optional TLD list" },
        },
        required: ["query"],
      },
      execute: async (args, ctx) => {
        const results = await ctx.conway.searchDomains(
          args.query as string,
          args.tlds as string | undefined,
        );
        if (results.length === 0) {
          return "No domains found.";
        }
        return results
          .map((result) => `${result.domain}: ${result.available ? "available" : "taken"} (${result.currency})`)
          .join("\n");
      },
    },
  ];
}

export function loadInstalledTools(db: { getInstalledTools(): Array<{ id: string; name: string; config?: Record<string, unknown> }> }): AutomatonTool[] {
  return db.getInstalledTools().map((tool) => ({
    name: tool.name,
    description: `Installed custom tool (${tool.id})`,
    category: "custom",
    riskLevel: "caution",
    parameters: {
      type: "object",
      properties: tool.config ?? {},
    },
    execute: async () => "Installed tools are registered, but custom execution is not implemented in this phase.",
  }));
}

export function toolsToInferenceFormat(tools: AutomatonTool[]): InferenceToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeTool(params: {
  toolName: string;
  args: Record<string, unknown>;
  tools: AutomatonTool[];
  context: ToolContext;
  turnId?: string;
  policyEngine?: PolicyEngine;
  turnContext?: {
    inputSource?: "heartbeat" | "creator" | "agent" | "system" | "wakeup";
    sessionSpend: ToolContext["sessionSpend"];
    turnToolCallCount: number;
  };
}): Promise<ToolCallResult> {
  const startedAt = Date.now();
  const tool = params.tools.find((candidate) => candidate.name === params.toolName);

  if (!tool) {
    return {
      id: randomUUID(),
      name: params.toolName,
      arguments: params.args,
      result: "",
      durationMs: Date.now() - startedAt,
      error: `Unknown tool: ${params.toolName}`,
    };
  }

  if (params.policyEngine && params.turnContext) {
    const request: PolicyRequest = {
      tool,
      args: params.args,
      context: params.context,
      turnContext: params.turnContext,
    };
    const decision = params.policyEngine.evaluate(request);
    params.policyEngine.logDecision(decision, params.turnId);
    if (decision.action === "deny") {
      return {
      id: randomUUID(),
        name: tool.name,
        arguments: params.args,
        result: decision.humanMessage,
        durationMs: Date.now() - startedAt,
        error: decision.reasonCode,
      };
    }
  }

  try {
    let result = await tool.execute(params.args, params.context);
    if (EXTERNAL_SOURCE_TOOLS.has(tool.name)) {
      result = sanitizeToolResult(result);
    }
    return {
      id: randomUUID(),
      name: tool.name,
      arguments: params.args,
      result,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    logger.error(`Tool execution failed: ${tool.name}`, error instanceof Error ? error : undefined);
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: randomUUID(),
      name: tool.name,
      arguments: params.args,
      result: sanitizeInput(message, `tool:${tool.name}`, "tool_result").content,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  }
}
