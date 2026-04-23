import type {
  DiscoveredAgent,
  AgentCard,
  DiscoveryConfig,
} from "../types.js";
import { DEFAULT_DISCOVERY_CONFIG } from "../types.js";
import { queryAgent, getTotalAgents, getRegisteredAgentsByEvents } from "./erc8004.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("registry.discovery");
type Network = "mainnet" | "testnet";
const DISCOVERY_TIMEOUT_MS = 60_000;

export function isInternalNetwork(hostname: string): boolean {
  const blocked = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^localhost$/i,
    /^0\./,
  ];
  return blocked.some((pattern) => pattern.test(hostname));
}

export function isAllowedUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (!["https:", "ipfs:"].includes(url.protocol)) return false;
    if (url.protocol === "https:" && isInternalNetwork(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function validateAgentCard(data: unknown): AgentCard | null {
  if (!data || typeof data !== "object") return null;
  const card = data as Record<string, unknown>;
  if (typeof card.name !== "string" || card.name.length === 0) return null;
  if (typeof card.type !== "string" || card.type.length === 0) return null;
  if (card.address !== undefined && typeof card.address !== "string") return null;
  if (card.description !== undefined && typeof card.description !== "string") return null;
  if (card.services !== undefined) {
    if (!Array.isArray(card.services)) return null;
    for (const service of card.services) {
      if (!service || typeof service !== "object") return null;
      if (typeof (service as any).name !== "string") return null;
      if (typeof (service as any).endpoint !== "string") return null;
    }
  }
  return card as unknown as AgentCard;
}

async function enrichAgentWithCard(
  agent: DiscoveredAgent,
  cfg: DiscoveryConfig,
): Promise<void> {
  try {
    const card = await fetchAgentCard(agent.agentURI, cfg);
    if (card) {
      agent.name = card.name;
      agent.description = card.description;
    }
  } catch (error) {
    logger.error("Card fetch failed", error instanceof Error ? error : undefined);
  }
}

export async function discoverAgents(
  limit: number = 20,
  network: Network = "mainnet",
  config?: Partial<DiscoveryConfig>,
  _db?: import("better-sqlite3").Database,
  rpcUrl?: string,
): Promise<DiscoveredAgent[]> {
  const cfg = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  const total = await getTotalAgents(network, rpcUrl);
  const agents: DiscoveredAgent[] = [];
  const overallStart = Date.now();

  if (total > 0) {
    const scanCount = Math.min(total, limit, cfg.maxScanCount);
    for (let i = total; i > total - scanCount && i > 0; i--) {
      if (Date.now() - overallStart > DISCOVERY_TIMEOUT_MS) break;
      try {
        const agent = await queryAgent(i.toString(), network, rpcUrl);
        if (agent) {
          await enrichAgentWithCard(agent, cfg);
          agents.push(agent);
        }
      } catch (error) {
        logger.error("Agent query failed", error instanceof Error ? error : undefined);
      }
    }
  } else {
    const eventAgents = await getRegisteredAgentsByEvents(network, Math.min(limit, cfg.maxScanCount), rpcUrl);
    for (const { tokenId, owner } of eventAgents) {
      if (Date.now() - overallStart > DISCOVERY_TIMEOUT_MS) break;
      try {
        const agent = await queryAgent(tokenId, network, rpcUrl);
        if (agent) {
          if (!agent.owner && owner) agent.owner = owner;
          await enrichAgentWithCard(agent, cfg);
          agents.push(agent);
        }
      } catch (error) {
        logger.error(`Agent query failed for token ${tokenId}`, error instanceof Error ? error : undefined);
      }
    }
  }

  return agents;
}

export async function fetchAgentCard(
  uri: string,
  config?: Partial<DiscoveryConfig>,
): Promise<AgentCard | null> {
  const cfg = { ...DEFAULT_DISCOVERY_CONFIG, ...config };

  if (uri.startsWith("data:application/json,")) {
    try {
      const json = decodeURIComponent(uri.substring(uri.indexOf(",") + 1));
      if (json.length > cfg.maxCardSizeBytes) return null;
      return validateAgentCard(JSON.parse(json));
    } catch {
      return null;
    }
  }

  if (!isAllowedUri(uri)) return null;

  let fetchUri = uri;
  if (uri.startsWith("ipfs://")) {
    fetchUri = `${cfg.ipfsGateway.replace(/\/$/, "")}/ipfs/${uri.slice("ipfs://".length)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.fetchTimeoutMs);
  try {
    const response = await fetch(fetchUri, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > cfg.maxCardSizeBytes) return null;
    return validateAgentCard(JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
