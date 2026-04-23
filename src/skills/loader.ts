import fs from "fs";
import path from "path";
import type { Skill, AutomatonDatabase } from "../types.js";
import { sanitizeInput } from "../agent/injection-defense.js";

function resolveHome(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return path.join(process.env.HOME || "/root", inputPath.slice(1));
  }
  return inputPath;
}

function parseSkillFile(content: string, skillPath: string): Skill | null {
  const lines = content.split("\n");
  const titleLine = lines.find((line) => line.startsWith("name:")) ?? "";
  const descriptionLine = lines.find((line) => line.startsWith("description:")) ?? "";
  const name = titleLine.replace(/^name:\s*/, "").trim() || path.basename(path.dirname(skillPath));
  const description = descriptionLine.replace(/^description:\s*/, "").trim() || "";

  if (!name) {
    return null;
  }

  return {
    name,
    description,
    autoActivate: true,
    instructions: content,
    source: "builtin",
    path: skillPath,
    enabled: true,
    installedAt: new Date().toISOString(),
  };
}

export function loadSkills(skillsDir: string, db: AutomatonDatabase): Skill[] {
  const resolvedDir = resolveHome(skillsDir);
  if (!fs.existsSync(resolvedDir)) {
    return db.getSkills(true);
  }

  const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMdPath = path.join(resolvedDir, entry.name, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    const content = fs.readFileSync(skillMdPath, "utf-8");
    const parsed = parseSkillFile(content, skillMdPath);
    if (parsed) {
      const existing = db.getSkillByName(parsed.name);
      if (existing) {
        parsed.enabled = existing.enabled;
        parsed.installedAt = existing.installedAt;
      }
      db.upsertSkill(parsed);
    }
  }

  return db.getSkills(true);
}

export function getActiveSkillInstructions(skills: Skill[]): string {
  const active = skills.filter((skill) => skill.enabled && skill.autoActivate);
  if (active.length === 0) {
    return "";
  }

  return active
    .map((skill) => {
      const sanitized = sanitizeInput(skill.instructions, `skill:${skill.name}`, "skill_instruction");
      return `[SKILL: ${skill.name}]\n${skill.description}\n\n${sanitized.content}\n[END SKILL: ${skill.name}]`;
    })
    .join("\n\n");
}
