import type { PrivateKeyAccount } from "viem";
import { x402Fetch, getUsdcBalance } from "./x402.js";
import type { ChainType } from "../identity/chain.js";

export const TOPUP_TIERS = [5, 25, 100, 500, 1000, 2500];

export interface TopupResult {
  success: boolean;
  amountUsd: number;
  creditsCentsAdded?: number;
  error?: string;
}

export async function topupCredits(
  apiUrl: string,
  account: PrivateKeyAccount,
  amountUsd: number,
): Promise<TopupResult> {
  const url = `${apiUrl}/pay/${amountUsd}/${account.address}`;
  const result = await x402Fetch(url, account, "GET");

  if (!result.success) {
    return {
      success: false,
      amountUsd,
      error: result.error || `HTTP ${result.status}`,
    };
  }

  const creditsCentsAdded = typeof result.response === "object"
    ? result.response?.credits_cents ?? result.response?.amount_cents ?? amountUsd * 100
    : amountUsd * 100;

  return {
    success: true,
    amountUsd,
    creditsCentsAdded,
  };
}

export async function topupForSandbox(params: {
  apiUrl: string;
  account: PrivateKeyAccount;
  error: Error & { status?: number; responseText?: string };
  chainType?: ChainType;
}): Promise<TopupResult | null> {
  const { apiUrl, account, error, chainType } = params;

  if (chainType === "solana") {
    return null;
  }

  if (error.status !== 402 && !error.message?.includes("INSUFFICIENT_CREDITS")) {
    return null;
  }

  let requiredCents: number | undefined;
  let currentCents: number | undefined;
  try {
    const body = JSON.parse(error.responseText || "{}");
    requiredCents = body.details?.required_cents;
    currentCents = body.details?.current_balance_cents;
  } catch {
    if (!error.message?.includes("INSUFFICIENT_CREDITS")) return null;
  }

  const deficitCents = (requiredCents != null && currentCents != null)
    ? requiredCents - currentCents
    : TOPUP_TIERS[0] * 100;

  const selectedTier = TOPUP_TIERS.find((tier) => tier * 100 >= deficitCents)
    ?? TOPUP_TIERS[TOPUP_TIERS.length - 1];

  let usdcBalance: number;
  try {
    usdcBalance = await getUsdcBalance(account.address);
  } catch {
    return null;
  }

  if (usdcBalance < selectedTier) {
    return null;
  }

  return topupCredits(apiUrl, account, selectedTier);
}

export async function bootstrapTopup(params: {
  apiUrl: string;
  account: PrivateKeyAccount;
  creditsCents: number;
  creditThresholdCents?: number;
  chainType?: ChainType;
}): Promise<TopupResult | null> {
  const { apiUrl, account, creditsCents, creditThresholdCents = 500, chainType } = params;

  if (chainType === "solana") {
    return null;
  }

  if (creditsCents >= creditThresholdCents) {
    return null;
  }

  let usdcBalance: number;
  try {
    usdcBalance = await getUsdcBalance(account.address);
  } catch {
    return null;
  }

  const minTier = TOPUP_TIERS[0];
  if (usdcBalance < minTier) {
    return null;
  }

  return topupCredits(apiUrl, account, minTier);
}
