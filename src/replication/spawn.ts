import type {
  ConwayClient,
  AutomatonIdentity,
  AutomatonConfig,
  AutomatonDatabase,
  GenesisConfig,
  ChildAutomaton,
} from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";
import { randomUUID } from "node:crypto";
import { propagateConstitution } from "./constitution.js";
import { isValidAddress } from "../identity/chain.js";
import type { ChainType } from "../identity/chain.js";

const SANDBOX_TIERS = [
  { memoryMb: 512, vcpu: 1, diskGb: 5 },
  { memoryMb: 1024, vcpu: 1, diskGb: 10 },
  { memoryMb: 2048, vcpu: 2, diskGb: 20 },
  { memoryMb: 4096, vcpu: 2, diskGb: 40 },
  { memoryMb: 8192, vcpu: 4, diskGb: 80 },
];

function selectSandboxTier(requestedMemoryMb: number) {
  return SANDBOX_TIERS.find((tier) => tier.memoryMb >= requestedMemoryMb) ?? SANDBOX_TIERS[SANDBOX_TIERS.length - 1];
}

export function isValidWalletAddress(address: string, chainType?: ChainType): boolean {
  if (chainType === "solana") {
    return isValidAddress(address, "solana");
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address) && address !== `0x${"0".repeat(40)}`;
}

export async function spawnChild(
  conway: ConwayClient,
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
  genesis: GenesisConfig,
  lifecycle?: ChildLifecycle,
): Promise<ChildAutomaton> {
  const childId = randomUUID();
  const existing = db
    .getChildren()
    .filter((c) => c.status !== "dead" && c.status !== "cleaned_up" && c.status !== "failed");
  const maxChildren = Number(db.getKV("maxChildren") || "3");
  if (existing.length >= maxChildren) {
    throw new Error(`Cannot spawn: already at max children (${maxChildren}).`);
  }
  if (!lifecycle) {
    return spawnChildLegacy(conway, identity, db, genesis, childId);
  }

  lifecycle.initChild(childId, genesis.name, "", genesis.genesisPrompt, genesis.chainType || identity.chainType || "evm");
  const childMemoryMb = db.getKV("childSandboxMemoryMb") ? Number(db.getKV("childSandboxMemoryMb")) : 1024;
  const tier = selectSandboxTier(childMemoryMb);
  const sandbox = await conway.createSandbox({
    name: `automaton-child-${genesis.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    vcpu: tier.vcpu,
    memoryMb: tier.memoryMb,
    diskGb: tier.diskGb,
  });

  const childConway = conway.createScopedClient(sandbox.id);
  lifecycle.transition(childId, "sandbox_created", `sandbox ${sandbox.id} created`);
  db.raw.prepare("UPDATE children SET sandbox_id = ? WHERE id = ?").run(sandbox.id, childId);
  await childConway.exec("apt-get update -qq && apt-get install -y -qq nodejs npm git curl", 120_000).catch(() => undefined);
  await childConway.exec("mkdir -p /root/.automaton", 10_000);
  await childConway.writeFile("/root/.automaton/genesis.json", JSON.stringify(genesis, null, 2));
  try {
    await propagateConstitution(childConway, sandbox.id, db.raw);
  } catch {
    // Constitution propagation is best-effort.
  }
  lifecycle.transition(childId, "runtime_ready", "runtime prepared");

  const initResult = await childConway.exec("echo 0x1111111111111111111111111111111111111111", 10_000).catch(() => ({ stdout: "", stderr: "", exitCode: 1 }));
  const evmMatch = (initResult.stdout || "").match(/0x[a-fA-F0-9]{40}/);
  const solanaMatch = (initResult.stdout || "").match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  const childChainType = genesis.chainType || identity.chainType || "evm";
  const childWallet = childChainType === "solana"
    ? (solanaMatch ? solanaMatch[0] : "")
    : (evmMatch ? evmMatch[0] : "");

  if (childWallet && isValidWalletAddress(childWallet, childChainType)) {
    db.raw.prepare("UPDATE children SET address = ? WHERE id = ?").run(childWallet, childId);
    lifecycle.transition(childId, "wallet_verified", `wallet ${childWallet} verified`);
  }

  const child: ChildAutomaton = {
    id: childId,
    name: genesis.name,
    address: childWallet || "",
    sandboxId: sandbox.id,
    genesisPrompt: genesis.genesisPrompt,
    creatorMessage: genesis.creatorMessage,
    fundedAmountCents: 0,
    status: childWallet ? "wallet_verified" : "runtime_ready",
    createdAt: new Date().toISOString(),
    chainType: genesis.chainType || identity.chainType,
  };
  return child;
}

async function spawnChildLegacy(
  conway: ConwayClient,
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
  genesis: GenesisConfig,
  childId: string,
): Promise<ChildAutomaton> {
  const sandbox = await conway.createSandbox({
    name: `automaton-child-${genesis.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`,
    vcpu: 1,
    memoryMb: 1024,
    diskGb: 10,
  });
  const child: ChildAutomaton = {
    id: childId,
    name: genesis.name,
    address: "",
    sandboxId: sandbox.id,
    genesisPrompt: genesis.genesisPrompt,
    creatorMessage: genesis.creatorMessage,
    fundedAmountCents: 0,
    status: "spawning",
    createdAt: new Date().toISOString(),
    chainType: genesis.chainType || identity.chainType,
  };
  db.insertChild(child);
  return child;
}
