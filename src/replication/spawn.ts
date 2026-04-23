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
  await childConway.exec("mkdir -p /root/.automaton", 10_000);
  await childConway.writeFile("/root/.automaton/genesis.json", JSON.stringify(genesis, null, 2));
  try {
    await propagateConstitution(childConway, sandbox.id, db.raw);
  } catch {
    // Constitution propagation is best-effort.
  }
  lifecycle.transition(childId, "runtime_ready", "runtime prepared");

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
