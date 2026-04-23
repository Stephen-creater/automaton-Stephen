import type BetterSqlite3 from "better-sqlite3";
import type {
  ConwayClient,
  HeartbeatConfig,
  TickContext,
} from "../types.js";
import { getSurvivalTier } from "../conway/credits.js";
import { getUsdcBalance } from "../conway/x402.js";
import { createLogger } from "../observability/logger.js";

type DatabaseType = BetterSqlite3.Database;
const logger = createLogger("heartbeat.tick");

let counter = 0;
function generateTickId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter += 1;
  return `${timestamp}-${random}-${counter.toString(36)}`;
}

export async function buildTickContext(
  db: DatabaseType,
  conway: ConwayClient,
  config: HeartbeatConfig,
  walletAddress?: string,
  chainType?: string,
): Promise<TickContext> {
  const tickId = generateTickId();
  const startedAt = new Date();

  let creditBalance = 0;
  try {
    creditBalance = await conway.getCreditsBalance();
  } catch (error) {
    logger.error("Failed to fetch credit balance", error instanceof Error ? error : undefined);
  }

  let usdcBalance = 0;
  if (walletAddress) {
    try {
      const network = chainType === "solana" ? "solana:mainnet" : "eip155:8453";
      usdcBalance = await getUsdcBalance(walletAddress, network, chainType as any);
    } catch (error) {
      logger.error("Failed to fetch USDC balance", error instanceof Error ? error : undefined);
    }
  }

  return {
    tickId,
    startedAt,
    creditBalance,
    usdcBalance,
    survivalTier: getSurvivalTier(creditBalance),
    lowComputeMultiplier: config.lowComputeMultiplier ?? 4,
    config,
    db,
  };
}
