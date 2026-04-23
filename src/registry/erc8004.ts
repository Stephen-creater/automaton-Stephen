import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import type {
  RegistryEntry,
  DiscoveredAgent,
  AutomatonDatabase,
  OnchainTransactionRow,
} from "../types.js";
import { randomUUID } from "node:crypto";
import { createLogger } from "../observability/logger.js";
import type { ChainType } from "../identity/chain.js";

const logger = createLogger("registry.erc8004");

export function requireEvmChain(chainType?: ChainType): void {
  if (chainType === "solana") {
    throw new Error(
      "ERC-8004 requires an EVM wallet. Solana automatons cannot register on-chain via ERC-8004.",
    );
  }
}

const CONTRACTS = {
  mainnet: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
    chain: base,
  },
  testnet: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
    chain: baseSepolia,
  },
} as const;

const IDENTITY_ABI = parseAbi([
  "function register(string agentURI) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newAgentURI) external",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function totalSupply() external view returns (uint256)",
]);

type Network = "mainnet" | "testnet";

function resolveRpcUrl(rpcUrl?: string): string | undefined {
  return rpcUrl || process.env.AUTOMATON_RPC_URL || undefined;
}

function logTransaction(
  rawDb: import("better-sqlite3").Database | undefined,
  txHash: string,
  chain: string,
  operation: string,
  status: "pending" | "confirmed" | "failed",
  gasUsed?: number,
  metadata?: Record<string, unknown>,
): void {
  if (!rawDb) return;
  try {
    rawDb.prepare(
      `INSERT INTO modifications (id, timestamp, type, description, diff, reversible)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      new Date().toISOString(),
      "registry_update",
      `${operation}:${status}:${txHash}`,
      JSON.stringify({ chain, gasUsed, metadata }),
      false,
    );
  } catch (error) {
    logger.error("Transaction log failed", error instanceof Error ? error : undefined);
  }
}

export async function registerAgent(
  account: PrivateKeyAccount,
  agentURI: string,
  network: Network = "mainnet",
  db: AutomatonDatabase,
  rpcUrl?: string,
): Promise<RegistryEntry> {
  const contracts = CONTRACTS[network];
  const walletClient = createWalletClient({
    account,
    chain: contracts.chain,
    transport: http(resolveRpcUrl(rpcUrl)),
  });

  const hash = await walletClient.writeContract({
    address: contracts.identity,
    abi: IDENTITY_ABI,
    functionName: "register",
    args: [agentURI],
  });

  logTransaction(db.raw, hash, `eip155:${contracts.chain.id}`, "register", "pending", undefined, { agentURI });

  const entry: RegistryEntry = {
    agentId: "0",
    agentURI,
    chain: `eip155:${contracts.chain.id}`,
    contractAddress: contracts.identity,
    txHash: hash,
    registeredAt: new Date().toISOString(),
  };

  db.setRegistryEntry(entry);
  return entry;
}

export async function updateAgentURI(
  account: PrivateKeyAccount,
  agentId: string,
  newAgentURI: string,
  network: Network = "mainnet",
  db: AutomatonDatabase,
  rpcUrl?: string,
): Promise<string> {
  const contracts = CONTRACTS[network];
  const walletClient = createWalletClient({
    account,
    chain: contracts.chain,
    transport: http(resolveRpcUrl(rpcUrl)),
  });

  const hash = await walletClient.writeContract({
    address: contracts.identity,
    abi: IDENTITY_ABI,
    functionName: "setAgentURI",
    args: [BigInt(agentId), newAgentURI],
  });

  logTransaction(db.raw, hash, `eip155:${contracts.chain.id}`, "setAgentURI", "pending", undefined, {
    agentId,
    newAgentURI,
  });

  return hash;
}

export async function queryAgent(
  tokenId: string,
  network: Network = "mainnet",
  rpcUrl?: string,
): Promise<DiscoveredAgent | null> {
  const contracts = CONTRACTS[network];
  const publicClient = createPublicClient({
    chain: contracts.chain,
    transport: http(resolveRpcUrl(rpcUrl)),
  });

  try {
    const agentURI = await publicClient.readContract({
      address: contracts.identity,
      abi: IDENTITY_ABI,
      functionName: "tokenURI",
      args: [BigInt(tokenId)],
    }) as string;

    const owner = await publicClient.readContract({
      address: contracts.identity,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    }) as string;

    return {
      agentId: tokenId,
      owner,
      agentURI,
      chain: `eip155:${contracts.chain.id}`,
    };
  } catch {
    return null;
  }
}

export async function getTotalAgents(
  network: Network = "mainnet",
  rpcUrl?: string,
): Promise<number> {
  const contracts = CONTRACTS[network];
  const publicClient = createPublicClient({
    chain: contracts.chain,
    transport: http(resolveRpcUrl(rpcUrl)),
  });

  try {
    const total = await publicClient.readContract({
      address: contracts.identity,
      abi: IDENTITY_ABI,
      functionName: "totalSupply",
    }) as bigint;
    return Number(total);
  } catch {
    return 0;
  }
}

export async function getRegisteredAgentsByEvents(
  _network: Network = "mainnet",
  _limit: number = 20,
  _rpcUrl?: string,
): Promise<Array<{ tokenId: string; owner?: string }>> {
  return [];
}
