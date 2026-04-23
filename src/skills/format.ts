import type { SkillFrontmatter, Skill, SkillSource } from "../types.js";

export function parseSkillMd(
  content: string,
  filePath: string,
  source: SkillSource = "builtin",
): Skill | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    const name = extractNameFromPath(filePath);
    return {
      name,
      description: "",
      autoActivate: true,
      instructions: trimmed,
      source,
      path: filePath,
      enabled: true,
      installedAt: new Date().toISOString(),
    };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return null;
  }

  const frontmatterRaw = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();
  const frontmatter = parseYamlFrontmatter(frontmatterRaw);
  if (!frontmatter) {
    return null;
  }

  return {
    name: frontmatter.name || extractNameFromPath(filePath),
    description: frontmatter.description || "",
    autoActivate: frontmatter["auto-activate"] !== false,
    requires: frontmatter.requires,
    instructions: body,
    source,
    path: filePath,
    enabled: true,
    installedAt: new Date().toISOString(),
  };
}

function parseYamlFrontmatter(raw: string): SkillFrontmatter | null {
  try {
    const result: Record<string, any> = {};
    const lines = raw.split("\n");
    let currentKey = "";
    let inList = false;
    let listKey = "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      if (trimmedLine.startsWith("- ") && inList) {
        const value = trimmedLine.slice(2).trim().replace(/^["']|["']$/g, "");
        if (listKey.startsWith("requires.")) {
          const nestedKey = listKey.slice("requires.".length);
          if (result.requires && Array.isArray(result.requires[nestedKey])) {
            result.requires[nestedKey].push(value);
          }
        } else {
          if (!result[listKey]) result[listKey] = [];
          if (Array.isArray(result[listKey])) {
            result[listKey].push(value);
          }
        }
        continue;
      }

      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      if (key === "requires") {
        result.requires = {};
        currentKey = "requires";
        inList = false;
        continue;
      }

      if (currentKey === "requires" && line.startsWith("  ")) {
        const nestedKey = key.trim();
        if (!value || value === "") {
          inList = true;
          listKey = `requires.${nestedKey}`;
          if (!result.requires) result.requires = {};
          result.requires[nestedKey] = [];
        } else if (value.startsWith("[") && value.endsWith("]")) {
          const items = value
            .slice(1, -1)
            .split(",")
            .map((item) => item.trim().replace(/^["']|["']$/g, ""));
          if (!result.requires) result.requires = {};
          result.requires[nestedKey] = items;
        }
        continue;
      }

      inList = false;
      currentKey = key;
      if (!value) continue;

      if (value === "true") {
        result[key] = true;
      } else if (value === "false") {
        result[key] = false;
      } else {
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }

    return result as SkillFrontmatter;
  } catch {
    return null;
  }
}

function extractNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const skillMdIndex = parts.findIndex((part) => part.toLowerCase() === "skill.md");
  if (skillMdIndex > 0) {
    return parts[skillMdIndex - 1];
  }
  return parts[parts.length - 1].replace(/\.md$/i, "");
}
