import type {
  AutomatonDatabase,
  InferenceClient,
  SurvivalTier,
} from "../types.js";

export interface ModeTransition {
  from: SurvivalTier;
  to: SurvivalTier;
  timestamp: string;
  creditsCents: number;
}

export function applyTierRestrictions(
  tier: SurvivalTier,
  inference: InferenceClient,
  db: AutomatonDatabase,
): void {
  switch (tier) {
    case "high":
    case "normal":
      inference.setLowComputeMode(false);
      break;
    case "low_compute":
    case "critical":
    case "dead":
      inference.setLowComputeMode(true);
      break;
  }

  db.setKV("current_tier", tier);
}

export function recordTransition(
  db: AutomatonDatabase,
  from: SurvivalTier,
  to: SurvivalTier,
  creditsCents: number,
): ModeTransition {
  const transition: ModeTransition = {
    from,
    to,
    timestamp: new Date().toISOString(),
    creditsCents,
  };

  const historyStr = db.getKV("tier_transitions") || "[]";
  const history: ModeTransition[] = JSON.parse(historyStr);
  history.push(transition);
  if (history.length > 50) history.splice(0, history.length - 50);
  db.setKV("tier_transitions", JSON.stringify(history));
  return transition;
}

export function canRunInference(tier: SurvivalTier): boolean {
  return tier === "high" || tier === "normal" || tier === "low_compute" || tier === "critical";
}

export function getModelForTier(
  tier: SurvivalTier,
  defaultModel: string,
): string {
  switch (tier) {
    case "high":
    case "normal":
      return defaultModel;
    case "low_compute":
    case "critical":
    case "dead":
      return "gpt-5-mini";
  }
}
