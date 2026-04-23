import type { PrivateKeyAccount } from "viem";
import type { SocialClientInterface, InboxMessage } from "../types.js";
import type { ChainIdentity } from "../identity/chain.js";
import { ResilientHttpClient } from "../conway/http-client.js";
import { signSendPayload, signPollPayload, MESSAGE_LIMITS } from "./signing.js";
import { validateRelayUrl, validateMessage } from "./validation.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("social");
const REQUEST_TIMEOUT_MS = 30_000;

export function createSocialClient(
  relayUrl: string,
  account: PrivateKeyAccount | ChainIdentity,
  db?: import("better-sqlite3").Database,
): SocialClientInterface {
  validateRelayUrl(relayUrl);

  const baseUrl = relayUrl.replace(/\/$/, "");
  const httpClient = new ResilientHttpClient();
  const outboundTimestamps: number[] = [];

  function checkRateLimit(): void {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    while (outboundTimestamps.length > 0 && outboundTimestamps[0]! < oneHourAgo) {
      outboundTimestamps.shift();
    }
    if (outboundTimestamps.length >= MESSAGE_LIMITS.maxOutboundPerHour) {
      throw new Error(`Rate limit exceeded: ${MESSAGE_LIMITS.maxOutboundPerHour} messages per hour`);
    }
  }

  function checkReplayNonce(nonce: string): boolean {
    if (!db) return false;
    try {
      const row = db.prepare(
        "SELECT 1 FROM kv WHERE key = ?",
      ).get(`social:nonce:${nonce}`);
      if (row) return true;
      db.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(`social:nonce:${nonce}`, new Date(Date.now() + MESSAGE_LIMITS.replayWindowMs).toISOString());
      return false;
    } catch {
      return false;
    }
  }

  return {
    send: async (to: string, content: string, replyTo?: string): Promise<{ id: string }> => {
      checkRateLimit();
      outboundTimestamps.push(Date.now());

      const senderAddress = "address" in account ? account.address : "";
      const validation = validateMessage({ from: senderAddress, to, content });
      if (!validation.valid) {
        throw new Error(`Message validation failed: ${validation.errors.join("; ")}`);
      }

      const payload = await signSendPayload(account, to, content, replyTo);
      const res = await httpClient.request(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Send failed (${res.status}): ${(err as any).error || res.statusText}`);
      }

      const data = await res.json() as { id: string };
      return { id: data.id };
    },

    poll: async (cursor?: string, limit?: number): Promise<{ messages: InboxMessage[]; nextCursor?: string }> => {
      const pollAuth = await signPollPayload(account);
      const res = await httpClient.request(`${baseUrl}/v1/messages/poll`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wallet-Address": pollAuth.address,
          "X-Signature": pollAuth.signature,
          "X-Timestamp": pollAuth.timestamp,
        },
        body: JSON.stringify({ cursor, limit }),
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Poll failed (${res.status}): ${(err as any).error || res.statusText}`);
      }

      const data = await res.json() as {
        messages: Array<{
          id: string;
          from: string;
          to: string;
          content: string;
          signedAt: string;
          createdAt: string;
          replyTo?: string;
          nonce?: string;
        }>;
        next_cursor?: string;
      };

      const filtered = data.messages.filter((message) => {
        if (message.nonce && checkReplayNonce(message.nonce)) {
          logger.warn(`Dropped replayed message: nonce=${message.nonce}`);
          return false;
        }
        return true;
      });

      return {
        messages: filtered.map((message) => ({
          id: message.id,
          from: message.from,
          to: message.to,
          content: message.content,
          signedAt: message.signedAt,
          createdAt: message.createdAt,
          replyTo: message.replyTo,
        })),
        nextCursor: data.next_cursor,
      };
    },

    unreadCount: async (): Promise<number> => {
      const pollAuth = await signPollPayload(account);
      const res = await httpClient.request(`${baseUrl}/v1/messages/count`, {
        method: "GET",
        headers: {
          "X-Wallet-Address": pollAuth.address,
          "X-Signature": pollAuth.signature,
          "X-Timestamp": pollAuth.timestamp,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(`Unread count failed (${res.status}): ${(err as any).error || res.statusText}`);
      }

      const data = await res.json() as { unread: number };
      return data.unread;
    },
  };
}
