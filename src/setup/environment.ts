import fs from "fs";

export type EnvironmentInfo = {
  type: string;
  sandboxId: string;
};

export function detectEnvironment(): EnvironmentInfo {
  const envSandboxId = process.env.CONWAY_SANDBOX_ID?.trim();
  if (envSandboxId) {
    return {
      type: "conway-sandbox",
      sandboxId: envSandboxId,
    };
  }

  try {
    if (fs.existsSync("/etc/conway/sandbox.json")) {
      const raw = fs.readFileSync("/etc/conway/sandbox.json", "utf8");
      const data = JSON.parse(raw) as { id?: string };
      const sandboxId = data.id?.trim();

      if (sandboxId) {
        return {
          type: "conway-sandbox",
          sandboxId,
        };
      }
    }
  } catch {
    // Ignore malformed sandbox metadata and fall back below.
  }

  if (fs.existsSync("/.dockerenv")) {
    return {
      type: "docker",
      sandboxId: "",
    };
  }

  return {
    type: process.platform,
    sandboxId: "",
  };
}
