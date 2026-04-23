import type {
  ConwayClient,
  AutomatonDatabase,
  InstalledTool,
} from "../types.js";
import { logModification } from "./audit-log.js";
import { randomUUID } from "node:crypto";

export async function installNpmPackage(
  conway: ConwayClient,
  db: AutomatonDatabase,
  packageName: string,
): Promise<{ success: boolean; error?: string }> {
  if (!/^[@a-zA-Z0-9._/-]+$/.test(packageName)) {
    return {
      success: false,
      error: `Invalid package name: ${packageName}`,
    };
  }

  const result = await conway.exec(
    `npm install -g ${packageName}`,
    120000,
  );

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `npm install failed: ${result.stderr}`,
    };
  }

  const tool: InstalledTool = {
    id: randomUUID(),
    name: packageName,
    type: "custom",
    config: { source: "npm", installCommand: `npm install -g ${packageName}` },
    installedAt: new Date().toISOString(),
    enabled: true,
  };

  db.installTool(tool);

  logModification(db, "tool_install", `Installed npm package: ${packageName}`, {
    reversible: true,
  });

  return { success: true };
}

export async function installMcpServer(
  _conway: ConwayClient,
  db: AutomatonDatabase,
  name: string,
  command: string,
  args?: string[],
  env?: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const tool: InstalledTool = {
    id: randomUUID(),
    name: `mcp:${name}`,
    type: "mcp",
    config: { command, args, env },
    installedAt: new Date().toISOString(),
    enabled: true,
  };

  db.installTool(tool);

  logModification(
    db,
    "mcp_install",
    `Installed MCP server: ${name} (${command})`,
    { reversible: true },
  );

  return { success: true };
}

export function listInstalledTools(
  db: AutomatonDatabase,
): InstalledTool[] {
  return db.getInstalledTools();
}

export function removeTool(
  db: AutomatonDatabase,
  toolId: string,
): void {
  db.removeTool(toolId);
  logModification(db, "tool_install", `Removed tool: ${toolId}`, {
    reversible: true,
  });
}
