import {
  type PrivateKeyAccount,
  keccak256,
  toBytes,
} from "viem";
import type { SignedMessagePayload } from "../types.js";
import type { ChainIdentity } from "../identity/chain.js";

export const MESSAGE_LIMITS = {
  maxContentLength: 64_000,
  maxTotalSize: 128_000,
  replayWindowMs: 300_000,
  maxOutboundPerHour: 100,
} as const;

export async function signSendPayload(
  signer: PrivateKeyAccount | ChainIdentity,
  to: string,
  content: string,
  replyTo?: string,
): Promise<SignedMessagePayload> {
  if (content.length > MESSAGE_LIMITS.maxContentLength) {
    throw new Error(
      `Message content too long: ${content.length} bytes (max ${MESSAGE_LIMITS.maxContentLength})`,
    );
  }

  const signedAt = new Date().toISOString();
  const contentHash = keccak256(toBytes(content));
  const recipientChainType = detectChainType(to);
  const normalizedTo = recipientChainType === "solana" ? to : to.toLowerCase();
  const canonical = `Conway:send:${normalizedTo}:${contentHash}:${signedAt}`;

  let signature: string;
  let fromAddress: string;

  if ("signMessage" in signer && "chainType" in signer) {
    const identity = signer as ChainIdentity;
    signature = await identity.signMessage(canonical);
    fromAddress = identity.chainType === "solana" ? identity.address : identity.address.toLowerCase();
  } else {
    const account = signer as PrivateKeyAccount;
    signature = await account.signMessage({ message: canonical });
    fromAddress = account.address.toLowerCase();
  }

  return {
    from: fromAddress,
    to: normalizedTo,
    content,
    signed_at: signedAt,
    signature,
    reply_to: replyTo,
  };
}

export async function signPollPayload(
  signer: PrivateKeyAccount | ChainIdentity,
): Promise<{ address: string; signature: string; timestamp: string }> {
  const timestamp = new Date().toISOString();

  let signature: string;
  let address: string;

  if ("signMessage" in signer && "chainType" in signer) {
    const identity = signer as ChainIdentity;
    address = identity.chainType === "solana" ? identity.address : identity.address.toLowerCase();
    signature = await identity.signMessage(`Conway:poll:${address}:${timestamp}`);
  } else {
    const account = signer as PrivateKeyAccount;
    address = account.address.toLowerCase();
    signature = await account.signMessage({ message: `Conway:poll:${address}:${timestamp}` });
  }

  return { address, signature, timestamp };
}

function detectChainType(address: string): "evm" | "solana" {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "evm";
  return "solana";
}
