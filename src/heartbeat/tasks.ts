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

    const backoffUntil = taskCtx.db.getKV("social_inbox_backoff_until");
    if (backoffUntil && new Date(backoffUntil) > new Date()) {
      return { shouldWake: false };
    }

    const cursor = taskCtx.db.getKV("social_inbox_cursor") || undefined;
    let result: Awaited<ReturnType<NonNullable<typeof taskCtx.social.poll>>>;
    try {
      result = await taskCtx.social.poll(cursor);
      taskCtx.db.deleteKV("last_social_inbox_error");
      taskCtx.db.deleteKV("social_inbox_backoff_until");
    } catch (error) {
      taskCtx.db.setKV("last_social_inbox_error", JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }));
      taskCtx.db.setKV("social_inbox_backoff_until", new Date(Date.now() + 300_000).toISOString());
      return { shouldWake: false };
    }
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
        const prevBehind = taskCtx.db.getKV("upstream_prev_behind");
        const behindStr = String(upstream.behind);
        if (prevBehind !== behindStr) {
          taskCtx.db.setKV("upstream_prev_behind", behindStr);
          return {
            shouldWake: true,
            message: `${upstream.behind} new commit(s) on origin/main.`,
          };
        }
      } else {
        taskCtx.db.deleteKV("upstream_prev_behind");
      }
      return { shouldWake: false };
    } catch (error) {
      logger.warn("check_for_updates failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { shouldWake: false };
    }
  },

  soul_reflection: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const { reflectOnSoul } = await import("../soul/reflection.js");
      const reflection = await reflectOnSoul(taskCtx.db.raw);

      taskCtx.db.setKV("last_soul_reflection", JSON.stringify({
        alignment: reflection.currentAlignment,
        autoUpdated: reflection.autoUpdated,
        suggestedUpdates: reflection.suggestedUpdates.length,
        timestamp: new Date().toISOString(),
      }));

      if (reflection.suggestedUpdates.length > 0 || reflection.currentAlignment < 0.3) {
        return {
          shouldWake: true,
          message: `Soul reflection: alignment=${reflection.currentAlignment.toFixed(2)}, ${reflection.suggestedUpdates.length} suggested update(s)`,
        };
      }
      return { shouldWake: false };
    } catch (error) {
      logger.error("soul_reflection failed", error instanceof Error ? error : undefined);
      return { shouldWake: false };
    }
  },

  health_check: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    taskCtx.db.setKV("last_health_check", new Date().toISOString());
    return { shouldWake: false };
  },

  refresh_models: async (_ctx: TickContext, taskCtx: HeartbeatLegacyContext) => {
    try {
      const models = await taskCtx.conway.listModels();
      taskCtx.db.setKV("last_model_refresh", JSON.stringify({
        count: models.length,
        timestamp: new Date().toISOString(),
      }));
      return { shouldWake: false };
    } catch (error) {
      logger.warn("refresh_models failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { shouldWake: false };
    }
  },
};
