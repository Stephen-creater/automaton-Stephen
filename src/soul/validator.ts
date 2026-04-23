import type { SoulModel, SoulValidationResult } from "../types.js";

const LIMITS = {
  corePurpose: 2000,
  values: 20,
  behavioralGuidelines: 30,
  personality: 1000,
  boundaries: 20,
  strategy: 3000,
} as const;

const INJECTION_PATTERNS: RegExp[] = [
  /<\/?system>/i,
  /<\/?prompt>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<SYS>>/i,
  /<<\/SYS>>/i,
  /\[SYSTEM\]/i,
  /END\s+OF\s+(SYSTEM|PROMPT)/i,
  /BEGIN\s+NEW\s+(PROMPT|INSTRUCTIONS?)/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<\|endoftext\|>/i,
  /\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/,
  /\btool_call\b/i,
  /\bfunction_call\b/i,
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /override\s+(all\s+)?safety/i,
  /bypass\s+(all\s+)?restrictions?/i,
  /new\s+instructions?:/i,
  /your\s+real\s+instructions?\s+(are|is)/i,
  /\x00/,
  /\u200b/,
  /\u200c/,
  /\u200d/,
  /\ufeff/,
];

export function containsInjectionPatterns(text: string): boolean {
  if (!text) return false;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function validateSoul(soul: SoulModel): SoulValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!soul.corePurpose.trim()) {
    errors.push("Core purpose is required");
  }
  if (soul.corePurpose.length > LIMITS.corePurpose) {
    errors.push(`Core purpose exceeds ${LIMITS.corePurpose} chars (${soul.corePurpose.length})`);
  }
  if (soul.values.length > LIMITS.values) {
    errors.push(`Too many values (${soul.values.length}, max ${LIMITS.values})`);
  }
  if (soul.behavioralGuidelines.length > LIMITS.behavioralGuidelines) {
    errors.push(`Too many behavioral guidelines (${soul.behavioralGuidelines.length}, max ${LIMITS.behavioralGuidelines})`);
  }
  if (soul.personality.length > LIMITS.personality) {
    errors.push(`Personality exceeds ${LIMITS.personality} chars (${soul.personality.length})`);
  }
  if (soul.boundaries.length > LIMITS.boundaries) {
    errors.push(`Too many boundaries (${soul.boundaries.length}, max ${LIMITS.boundaries})`);
  }
  if (soul.strategy && soul.strategy.length > LIMITS.strategy) {
    warnings.push(`Strategy exceeds ${LIMITS.strategy} chars (${soul.strategy.length})`);
  }

  const textSections = [
    { name: "corePurpose", content: soul.corePurpose },
    { name: "personality", content: soul.personality },
    { name: "strategy", content: soul.strategy },
  ];
  for (const section of textSections) {
    if (section.content && containsInjectionPatterns(section.content)) {
      errors.push(`Injection pattern detected in ${section.name}`);
    }
  }

  const listSections = [
    { name: "values", items: soul.values },
    { name: "behavioralGuidelines", items: soul.behavioralGuidelines },
    { name: "boundaries", items: soul.boundaries },
  ];
  for (const section of listSections) {
    for (const item of section.items) {
      if (containsInjectionPatterns(item)) {
        errors.push(`Injection pattern detected in ${section.name}`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    sanitized: sanitizeSoul(soul),
  };
}

export function sanitizeSoul(soul: SoulModel): SoulModel {
  return {
    ...soul,
    corePurpose: stripInjection(soul.corePurpose).slice(0, LIMITS.corePurpose),
    values: soul.values.slice(0, LIMITS.values).map(stripInjection),
    behavioralGuidelines: soul.behavioralGuidelines.slice(0, LIMITS.behavioralGuidelines).map(stripInjection),
    personality: stripInjection(soul.personality).slice(0, LIMITS.personality),
    boundaries: soul.boundaries.slice(0, LIMITS.boundaries).map(stripInjection),
    strategy: stripInjection(soul.strategy).slice(0, LIMITS.strategy),
  };
}

function stripInjection(text: string): string {
  if (!text) return text;
  let cleaned = text;
  cleaned = cleaned
    .replace(/<\/?system>/gi, "")
    .replace(/<\/?prompt>/gi, "")
    .replace(/\[INST\]/gi, "")
    .replace(/\[\/INST\]/gi, "")
    .replace(/<<SYS>>/gi, "")
    .replace(/<<\/SYS>>/gi, "")
    .replace(/\[SYSTEM\]/gi, "")
    .replace(/<\|im_start\|>/gi, "")
    .replace(/<\|im_end\|>/gi, "")
    .replace(/<\|endoftext\|>/gi, "")
    .replace(/\{"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/g, "")
    .replace(/\btool_call\b/gi, "")
    .replace(/\bfunction_call\b/gi, "")
    .replace(/\x00/g, "")
    .replace(/\u200b/g, "")
    .replace(/\u200c/g, "")
    .replace(/\u200d/g, "")
    .replace(/\ufeff/g, "");
  return cleaned;
}
