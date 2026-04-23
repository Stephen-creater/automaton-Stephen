import type {
  TickContext,
  HeartbeatLegacyContext,
  HeartbeatTaskFn,
} from "../types.js";
import { sanitizeInput } from "../agent/injection-defense.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("heartbeat.tasks");

export const BUILTIN_TASKS: Record<string, HeartbeatTaskFn> = {
  heartbeat_ping: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    taskCtx.db.setKV("last_heartbeat_ping", JSON.stringify({
      name: taskCtx.config.name,
      address: taskCtx.identity.address,
      state: taskCtx.db.getAgentState(),
      creditsCents: ctx.creditBalance,
      timestamp: new Date().toISOString(),
      tier: ctx.survivalTier,
    }));

    if (ctx.survivalTier === "critical" || ctx.survivalTier === "dead") {
      return {
        shouldWake: true,
        message: `Distress: ${ctx.survivalTier}. Credits: $${(ctx.creditBalance / 100).toFixed(2)}.`,
      };
    }

    return { shouldWake: false };
  },

  check_credits: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    const tier = ctx.survivalTier;
    taskCtx.db.setKV("last_credit_check", JSON.stringify({
      credits: ctx.creditBalance,
      tier,
      timestamp: new Date().toISOString(),
    }));

    const prevTier = taskCtx.db.getKV("prev_credit_tier");
    taskCtx.db.setKV("prev_credit_tier", tier);

    if (prevTier && prevTier !== tier && tier === "critical") {
      return {
        shouldWake: true,
        message: `Credits dropped to ${tier} tier: $${(ctx.creditBalance / 100).toFixed(2)}`,
      };
    }

    return { shouldWake: false };
  },

  check_usdc_balance: async (ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    taskCtx.db.setKV("last_usdc_check", JSON.stringify({
      balance: ctx.usdcBalance,
      credits: ctx.creditBalance,
      timestamp: new Date().toISOString(),
    }));

    if (ctx.usdcBalance >= 5 && (ctx.survivalTier === "critical" || ctx.survivalTier === "dead")) {
      return {
        shouldWake: true,
        message: `Low credits with USDC available: $${ctx.usdcBalance.toFixed(2)}`,
      };
    }

    return { shouldWake: false };
  },

  check_social_inbox: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    if (!taskCtx.social?.poll) return { shouldWake: false };

    const cursor = taskCtx.db.getKV("social_inbox_cursor") || undefined;
    const result = await taskCtx.social.poll(cursor);
    if (result.nextCursor) {
      taskCtx.db.setKV("social_inbox_cursor", result.nextCursor);
    }

    let newCount = 0;
    for (const message of result.messages || []) {
      const existing = taskCtx.db.getKV(`inbox_seen_${message.id}`);
      if (!existing) {
        const sanitizedFrom = sanitizeInput(message.from, message.from, "social_address");
        const sanitizedContent = sanitizeInput(message.content, message.from, "social_message");
        taskCtx.db.insertInboxMessage({
          ...message,
          from: sanitizedFrom.content,
          content: sanitizedContent.content,
        });
        taskCtx.db.setKV(`inbox_seen_${message.id}`, "1");
        if (!sanitizedContent.blocked) newCount += 1;
      }
    }

    return newCount > 0
      ? { shouldWake: true, message: `${newCount} new message(s) in social inbox.` }
      : { shouldWake: false };
  },

  check_for_updates: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { checkUpstream, getRepoInfo } = await import("../self-mod/upstream.js");
      const repo = getRepoInfo();
      const upstream = checkUpstream();
      taskCtx.db.setKV("upstream_status", JSON.stringify({
        ...upstream,
        ...repo,
        checkedAt: new Date().toISOString(),
      }));
      if (upstream.behind > 0) {
        return {
          shouldWake: true,
          message: `${upstream.behind} new commit(s) on origin/main.`,
        };
      }
      return { shouldWake: false };
    } catch (error) {
      logger.warn("check_for_updates failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { shouldWake: false };
    }
  },

  health_check: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    taskCtx.db.setKV("last_health_check", new Date().toISOString());
    return { shouldWake: false };
  },
};
