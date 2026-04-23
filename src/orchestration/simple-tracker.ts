import type { AutomatonDatabase, ConwayClient, AutomatonIdentity } from "../types.js";
import type { AgentTracker, FundingProtocol } from "./types.js";

export class SimpleAgentTracker implements AgentTracker {
  constructor(private readonly db: AutomatonDatabase) {}

  getIdle(): { address: string; name: string; role: string; status: string }[] {
    return this.db.getChildren()
      .filter((child) => child.status === "running" || child.status === "sleeping")
      .map((child) => ({
        address: child.address,
        name: child.name,
        role: "generalist",
        status: child.status,
      }));
  }

  getBestForTask(role: string): { address: string; name: string } | null {
    const idle = this.getIdle();
    const exact = idle.find((agent) => agent.role === role);
    if (exact) return { address: exact.address, name: exact.name };
    const first = idle[0];
    return first ? { address: first.address, name: first.name } : null;
  }

  updateStatus(address: string, status: string): void {
    const child = this.db.getChildren().find((item) => item.address === address);
    if (child) {
      this.db.updateChildStatus(child.id, status as any);
    }
  }

  register(agent: { address: string; name: string; role: string; sandboxId: string }): void {
    this.db.insertChild({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name: agent.name,
      address: agent.address,
      sandboxId: agent.sandboxId,
      genesisPrompt: agent.role,
      fundedAmountCents: 0,
      status: "running",
      createdAt: new Date().toISOString(),
    });
  }
}

export class SimpleFundingProtocol implements FundingProtocol {
  constructor(
    private readonly conway: ConwayClient,
    private readonly identity: AutomatonIdentity,
    private readonly db: AutomatonDatabase,
  ) {}

  async fundChild(childAddress: string, amountCents: number): Promise<{ success: boolean }> {
    await this.conway.transferCredits(childAddress, amountCents, "task funding");
    return { success: true };
  }

  async recallCredits(_childAddress: string): Promise<{ success: boolean; amountCents: number }> {
    return { success: true, amountCents: 0 };
  }

  async getBalance(_childAddress: string): Promise<number> {
    return 0;
  }
}
