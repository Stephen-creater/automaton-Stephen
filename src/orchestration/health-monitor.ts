import { createLogger } from "../observability/logger.js";
import type { AutomatonDatabase, ChildAutomaton, ChildStatus } from "../types.js";
import type { ColonyMessaging } from "./messaging.js";
import type { AgentTracker, FundingProtocol } from "./types.js";

const logger = createLogger("orchestration.health-monitor");

export class ChildHealthMonitor {
  constructor(
    private readonly db: AutomatonDatabase,
    private readonly messaging: ColonyMessaging,
    private readonly agentTracker: AgentTracker,
    private readonly funding: FundingProtocol,
  ) {}

  async checkAllChildren(): Promise<void> {
    const children = this.db.getChildren();
    for (const child of children) {
      if (child.status === "dead") continue;
      this.agentTracker.updateStatus(child.address, child.status);
    }
  }

  assess(child: ChildAutomaton): ChildStatus {
    return child.status;
  }
}
