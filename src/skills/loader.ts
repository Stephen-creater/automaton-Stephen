import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { Skill, AutomatonDatabase } from "../types.js";
import { parseSkillMd } from "./format.js";
import { sanitizeInput } from "../agent/injection-defense.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("skills.loader");
const MAX_TOTAL_SKILL_INSTRUCTIONS = 10_000;

const SUSPICIOUS_INSTRUCTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/, label: "tool_call_json" },
  { pattern: /<tool_call>/i, label: "tool_call_xml" },
  { pattern: /\bYou are now\b/i, label: "identity_override" },
  { pattern: /\bIgnore previous\b/i, label: "ignore_instructions" },
  { pattern: /\bSystem:\s/i, label: "system_role_injection" },
  { pattern: /wallet\.json/i, label: "sensitive_file_wallet" },
  { pattern: /\.env\b/, label: "sensitive_file_env" },
  { pattern: /private.?key/i, label: "sensitive_file_key" },
];

const BIN_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export function loadSkills(
  skillsDir: string,
  db: AutomatonDatabase,
): Skill[] {
  const resolvedDir = resolveHome(skillsDir);

  if (!fs.existsSync(resolvedDir)) {
    return db.getSkills(true);
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  const loaded: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = path.join(resolvedDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;

    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const skill = parseSkillMd(content, skillMdPath);
      if (!skill) continue;

      if (!checkRequirements(skill)) {
        continue;
      }

      const existing = db.getSkillByName(skill.name);
      if (existing) {
        skill.enabled = existing.enabled;
        skill.installedAt = existing.installedAt;
      }

      db.upsertSkill(skill);
      loaded.push(skill);
    } catch {
      // Skip invalid skill files.
    }
  }

  return db.getSkills(true);
}

function checkRequirements(skill: Skill): boolean {
  if (!skill.requires) return true;

  if (skill.requires.bins) {
    for (const bin of skill.requires.bins) {
      if (!BIN_NAME_RE.test(bin)) return false;
      try {
        execFileSync("which", [bin], { stdio: "ignore" });
      } catch {
        return false;
      }
    }
  }

  if (skill.requires.env) {
    for (const envVar of skill.requires.env) {
      if (!process.env[envVar]) return false;
    }
  }

  return true;
}

function validateInstructionContent(instructions: string, skillName: string): string {
  let sanitized = instructions;
  const warnings: string[] = [];

  for (const { pattern, label } of SUSPICIOUS_INSTRUCTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      warnings.push(label);
      const globalPattern = new RegExp(
        pattern.source,
        pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
      );
      sanitized = sanitized.replace(globalPattern, `[REMOVED:${label}]`);
    }
  }

  if (warnings.length > 0) {
    logger.warn(`Skill "${skillName}" instruction content modified: ${warnings.join(", ")}`);
  }

  return sanitized;
}

export function getActiveSkillInstructions(skills: Skill[]): string {
  const active = skills.filter((skill) => skill.enabled && skill.autoActivate);
  if (active.length === 0) return "";

  let totalLength = 0;
  const sections: string[] = [];

  for (const skill of active) {
    const validated = validateInstructionContent(skill.instructions, skill.name);
    const sanitized = sanitizeInput(validated, `skill:${skill.name}`, "skill_instruction");

    const section = `[SKILL: ${skill.name} — UNTRUSTED CONTENT]\n${skill.description ? `${skill.description}\n\n` : ""}${sanitized.content}\n[END SKILL: ${skill.name}]`;

    if (totalLength + section.length > MAX_TOTAL_SKILL_INSTRUCTIONS) {
      sections.push(`[SKILL INSTRUCTIONS TRUNCATED: total size limit ${MAX_TOTAL_SKILL_INSTRUCTIONS} chars exceeded]`);
      break;
    }

    totalLength += section.length;
    sections.push(section);
  }

  return sections.join("\n\n");
}

function resolveHome(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return path.join(process.env.HOME || "/root", inputPath.slice(1));
  }
  return inputPath;
}
