import fs from "fs";
import path from "path";
import type { AutomatonConfig, SoulModel } from "../types.js";

function getSoulPath(): string {
  return path.join(process.env.HOME || process.cwd(), ".automaton", "SOUL.md");
}

function buildFallbackSoul(config: AutomatonConfig): SoulModel {
  return {
    summary: `Core purpose: ${config.genesisPrompt}`,
    content: `# SOUL\n\n## Core Purpose\n${config.genesisPrompt}\n`,
    path: getSoulPath(),
  };
}

export function loadCurrentSoul(config: AutomatonConfig): SoulModel {
  const soulPath = getSoulPath();
  if (!fs.existsSync(soulPath)) {
    return buildFallbackSoul(config);
  }
  const content = fs.readFileSync(soulPath, "utf-8");
  const summarySection = content.split("\n").slice(0, 12).join("\n");
  return {
    summary: summarySection.trim() || `Core purpose: ${config.genesisPrompt}`,
    content,
    path: soulPath,
  };
}
