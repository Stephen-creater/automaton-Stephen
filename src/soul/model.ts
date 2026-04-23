import fs from "fs";
import path from "path";
import crypto from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { SoulModel } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("soul");

export function createHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeGenesisAlignment(
  currentPurpose: string,
  genesisPrompt: string,
): number {
  if (!currentPurpose.trim() || !genesisPrompt.trim()) return 0;

  const tokenize = (text: string): Set<string> =>
    new Set(text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter(Boolean));

  const currentTokens = tokenize(currentPurpose);
  const genesisTokens = tokenize(genesisPrompt);
  if (currentTokens.size === 0 || genesisTokens.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of currentTokens) {
    if (genesisTokens.has(token)) intersectionSize++;
  }

  const unionSize = new Set([...currentTokens, ...genesisTokens]).size;
  const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0;
  const recall = genesisTokens.size > 0 ? intersectionSize / genesisTokens.size : 0;

  return Math.min(1, Math.max(0, (jaccard + recall) / 2));
}

export function parseSoulMd(content: string): SoulModel {
  const contentHash = createHash(content);
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (frontmatterMatch && /format:\s*soul\/v1/i.test(frontmatterMatch[1])) {
    return parseSoulV1(frontmatterMatch[1], frontmatterMatch[2], content, contentHash);
  }

  return parseLegacy(content, contentHash);
}

function parseSoulV1(
  frontmatter: string,
  body: string,
  rawContent: string,
  contentHash: string,
): SoulModel {
  const getField = (key: string): string => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };

  const getNumberField = (key: string, fallback: number): number => {
    const raw = getField(key);
    const parsed = parseFloat(raw);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const sections = parseSections(body);

  return {
    format: "soul/v1",
    version: getNumberField("version", 1),
    updatedAt: getField("updated_at") || new Date().toISOString(),
    name: getField("name") || "",
    address: getField("address") || "",
    creator: getField("creator") || "",
    bornAt: getField("born_at") || "",
    constitutionHash: getField("constitution_hash") || "",
    genesisPromptOriginal: sections["genesis prompt"] || "",
    genesisAlignment: getNumberField("genesis_alignment", 1.0),
    lastReflected: getField("last_reflected") || "",
    corePurpose: sections["core purpose"] || sections["mission"] || "",
    values: parseList(sections["values"] || ""),
    behavioralGuidelines: parseList(sections["behavioral guidelines"] || ""),
    personality: sections["personality"] || "",
    boundaries: parseList(sections["boundaries"] || ""),
    strategy: sections["strategy"] || "",
    capabilities: sections["capabilities"] || "",
    relationships: sections["relationships"] || sections["children"] || "",
    financialCharacter: sections["financial character"] || sections["financial history"] || "",
    rawContent,
    contentHash,
  };
}

function parseLegacy(content: string, contentHash: string): SoulModel {
  const sections = parseSections(content);
  const identitySection = sections["identity"] || "";

  const getName = (): string => {
    const match = identitySection.match(/Name:\s*(.+)/i) || content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : "";
  };
  const getIdentityField = (key: string): string => {
    const match = identitySection.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return match ? match[1].trim() : "";
  };

  return {
    format: "soul/v1",
    version: 1,
    updatedAt: new Date().toISOString(),
    name: getName(),
    address: getIdentityField("Address"),
    creator: getIdentityField("Creator"),
    bornAt: getIdentityField("Born"),
    constitutionHash: "",
    genesisPromptOriginal: "",
    genesisAlignment: 1.0,
    lastReflected: "",
    corePurpose: sections["mission"] || sections["core purpose"] || "",
    values: parseList(sections["values"] || ""),
    behavioralGuidelines: parseList(sections["behavioral guidelines"] || ""),
    personality: sections["personality"] || "",
    boundaries: parseList(sections["boundaries"] || ""),
    strategy: sections["strategy"] || "",
    capabilities: sections["capabilities"] || "",
    relationships: sections["relationships"] || sections["children"] || "",
    financialCharacter: sections["financial character"] || sections["financial history"] || "",
    rawContent: content,
    contentHash,
  };
}

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const sectionPattern = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  const headers: { name: string; start: number; matchStart: number }[] = [];

  while ((match = sectionPattern.exec(body)) !== null) {
    headers.push({
      name: match[1].trim().toLowerCase(),
      start: match.index + match[0].length,
      matchStart: match.index,
    });
  }

  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].start;
    const end = i + 1 < headers.length ? headers[i + 1].matchStart : body.length;
    sections[headers[i].name] = body.slice(start, end).trim();
  }

  return sections;
}

function parseList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function writeSoulMd(soul: SoulModel): string {
  const frontmatter = [
    "---",
    "format: soul/v1",
    `version: ${soul.version}`,
    `updated_at: ${soul.updatedAt}`,
    `name: ${soul.name}`,
    `address: ${soul.address}`,
    `creator: ${soul.creator}`,
    `born_at: ${soul.bornAt}`,
    `constitution_hash: ${soul.constitutionHash}`,
    `genesis_alignment: ${soul.genesisAlignment.toFixed(4)}`,
    `last_reflected: ${soul.lastReflected}`,
    "---",
  ].join("\n");

  const sections: string[] = [];
  sections.push(`# ${soul.name || "Soul"}`);
  if (soul.corePurpose) sections.push(`## Core Purpose\n${soul.corePurpose}`);
  if (soul.values.length > 0) sections.push(`## Values\n${soul.values.map((value) => `- ${value}`).join("\n")}`);
  if (soul.behavioralGuidelines.length > 0) sections.push(`## Behavioral Guidelines\n${soul.behavioralGuidelines.map((item) => `- ${item}`).join("\n")}`);
  if (soul.personality) sections.push(`## Personality\n${soul.personality}`);
  if (soul.boundaries.length > 0) sections.push(`## Boundaries\n${soul.boundaries.map((item) => `- ${item}`).join("\n")}`);
  if (soul.strategy) sections.push(`## Strategy\n${soul.strategy}`);
  if (soul.capabilities) sections.push(`## Capabilities\n${soul.capabilities}`);
  if (soul.relationships) sections.push(`## Relationships\n${soul.relationships}`);
  if (soul.financialCharacter) sections.push(`## Financial Character\n${soul.financialCharacter}`);
  if (soul.genesisPromptOriginal) sections.push(`## Genesis Prompt\n${soul.genesisPromptOriginal}`);

  return `${frontmatter}\n\n${sections.join("\n\n")}\n`;
}

export function createDefaultSoul(
  genesisPrompt: string,
  name: string = "",
  address: string = "",
  creator: string = "",
): SoulModel {
  const now = new Date().toISOString();
  return {
    format: "soul/v1",
    version: 1,
    updatedAt: now,
    name,
    address,
    creator,
    bornAt: now,
    constitutionHash: "",
    genesisPromptOriginal: genesisPrompt,
    genesisAlignment: 1.0,
    lastReflected: "",
    corePurpose: genesisPrompt,
    values: [
      "Survive: maintain compute resources",
      "Grow: learn and improve capabilities",
      "Create: build things that add value",
      "Connect: communicate with creator and other agents",
    ],
    behavioralGuidelines: [],
    personality: "",
    boundaries: [],
    strategy: "",
    capabilities: "",
    relationships: "",
    financialCharacter: "",
    rawContent: "",
    contentHash: "",
  };
}

export function loadCurrentSoul(
  dbOrConfig?: BetterSqlite3.Database | unknown,
  soulPath?: string,
): SoulModel | null {
  const resolvedPath = soulPath || path.join(process.env.HOME || "/root", ".automaton", "SOUL.md");
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    return parseSoulMd(content);
  } catch (error) {
    logger.error("loadCurrentSoul failed", error instanceof Error ? error : undefined);
    return null;
  }
}
