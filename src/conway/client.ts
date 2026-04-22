import path from "path";

type ConwayClientOptions = {
  apiUrl: string;
  apiKey: string;
  sandboxId: string;
};

export function normalizeSandboxId(value: string | null | undefined): string {
  const normalized = value?.trim() || "";

  if (!normalized) {
    return "";
  }

  if (normalized === "undefined" || normalized === "null") {
    return "";
  }

  return normalized;
}

export function isLocalMode(options: ConwayClientOptions): boolean {
  const sandboxId = normalizeSandboxId(options.sandboxId);
  return !sandboxId;
}

export function resolveLocalPath(filePath: string): string {
  if (filePath.startsWith("~")) {
    return path.join(process.env.HOME || "/root", filePath.slice(1));
  }

  return filePath;
}
