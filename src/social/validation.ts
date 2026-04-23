import type { MessageValidationResult } from "../types.js";
import { MESSAGE_LIMITS } from "./signing.js";
import { isValidAddress } from "../identity/chain.js";

export function validateMessage(message: {
  from: string;
  to: string;
  content: string;
  signed_at?: string;
  timestamp?: string;
}): MessageValidationResult {
  const errors: string[] = [];

  const totalSize = JSON.stringify(message).length;
  if (totalSize > MESSAGE_LIMITS.maxTotalSize) {
    errors.push(`Message exceeds total size limit: ${totalSize} > ${MESSAGE_LIMITS.maxTotalSize}`);
  }
  if (message.content.length > MESSAGE_LIMITS.maxContentLength) {
    errors.push(`Content exceeds size limit: ${message.content.length} > ${MESSAGE_LIMITS.maxContentLength}`);
  }

  const ts = message.signed_at || message.timestamp;
  if (ts) {
    const parsed = new Date(ts).getTime();
    if (Number.isNaN(parsed)) {
      errors.push("Invalid timestamp");
    } else {
      const age = Date.now() - parsed;
      if (age > MESSAGE_LIMITS.replayWindowMs) {
        errors.push("Message too old (possible replay)");
      }
      if (age < -60_000) {
        errors.push("Message from future");
      }
    }
  }

  const fromChain = /^0x/.test(message.from) ? "evm" : "solana";
  const toChain = /^0x/.test(message.to) ? "evm" : "solana";
  if (!isValidAddress(message.from, fromChain)) {
    errors.push("Invalid sender address");
  }
  if (!isValidAddress(message.to, toChain)) {
    errors.push("Invalid recipient address");
  }

  return { valid: errors.length === 0, errors };
}

export function validateRelayUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid relay URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Relay URL must use HTTPS: ${url}`);
  }
}
