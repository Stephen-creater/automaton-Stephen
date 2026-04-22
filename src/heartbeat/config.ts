import fs from "fs";
import path from "path";
import { getAutomatonDir } from "../identity/wallet.js";

const DEFAULT_HEARTBEAT_YML = `entries:
  - name: heartbeat_ping
    schedule: "*/15 * * * *"
    task: heartbeat_ping
    enabled: true
  - name: check_credits
    schedule: "0 */6 * * *"
    task: check_credits
    enabled: true
  - name: check_usdc_balance
    schedule: "*/5 * * * *"
    task: check_usdc_balance
    enabled: true
  - name: check_for_updates
    schedule: "0 */4 * * *"
    task: check_for_updates
    enabled: true
  - name: health_check
    schedule: "*/30 * * * *"
    task: health_check
    enabled: true
  - name: check_social_inbox
    schedule: "*/2 * * * *"
    task: check_social_inbox
    enabled: true
defaultIntervalMs: 60000
lowComputeMultiplier: 4
`;

export function writeDefaultHeartbeatConfig(): void {
  const heartbeatPath = path.join(getAutomatonDir(), "heartbeat.yml");
  const dir = path.dirname(heartbeatPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(heartbeatPath, DEFAULT_HEARTBEAT_YML, { mode: 0o600 });
}
