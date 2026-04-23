import crypto from "crypto";
import { randomUUID } from "node:crypto";
import {
  keccak256,
  toBytes,
  verifyMessage,
} from "viem";

export interface SignedMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export function createMessageId(): string {
  return randomUUID();
}

export function createNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function verifyMessageSignature(
  message: { to: string; content: string; signed_at: string; signature: string },
  expectedFrom: string,
): Promise<boolean> {
  try {
    const contentHash = keccak256(toBytes(message.content));
    const canonical = `Conway:send:${message.to.toLowerCase()}:${contentHash}:${message.signed_at}`;
    return await verifyMessage({
      address: expectedFrom as `0x${string}`,
      message: canonical,
      signature: message.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
