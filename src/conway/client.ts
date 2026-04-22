import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { keccak256, toHex } from "viem";
import type { PrivateKeyAccount } from "viem";
import type { ChainIdentity, ChainType } from "../identity/chain.js";
import type {
  ConwayClient,
  ExecResult,
  PortInfo,
  CreateSandboxOptions,
  SandboxInfo,
  PricingTier,
  CreditTransferResult,
  DomainSearchResult,
  DomainRegistration,
  DnsRecord,
  ModelInfo,
} from "../types.js";
import { ResilientHttpClient } from "./http-client.js";

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

export function createConwayClient(options: ConwayClientOptions): ConwayClient {
  const { apiUrl, apiKey } = options;
  const sandboxId = normalizeSandboxId(options.sandboxId);
  const isLocal = !sandboxId;
  const httpClient = new ResilientHttpClient();

  const canonicalizePayload = (payload: Record<string, string>): string => {
    const sortedKeys = Object.keys(payload).sort();
    const sorted: Record<string, string> = {};

    for (const key of sortedKeys) {
      sorted[key] = payload[key];
    }

    return JSON.stringify(sorted);
  };

  const hashIdentityPayload = (payload: Record<string, string>): `0x${string}` => {
    const canonical = canonicalizePayload(payload);
    return keccak256(toHex(canonical));
  };

  async function request(
    method: string,
    requestPath: string,
    body?: unknown,
    requestOptions?: { idempotencyKey?: string; retries404?: number },
  ): Promise<unknown> {
    const max404Retries = requestOptions?.retries404 ?? 3;

    for (let attempt = 0; attempt <= max404Retries; attempt++) {
      const response = await httpClient.request(`${apiUrl}${requestPath}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        idempotencyKey: requestOptions?.idempotencyKey,
      });

      if (response.status === 404 && attempt < max404Retries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        const error: Error & {
          status?: number;
          responseText?: string;
          method?: string;
          path?: string;
        } = new Error(`Conway API error: ${method} ${requestPath} -> ${response.status}: ${text}`);
        error.status = response.status;
        error.responseText = text;
        error.method = method;
        error.path = requestPath;
        throw error;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return response.json();
      }

      return response.text();
    }

    throw new Error("Unreachable");
  }

  async function exec(command: string, timeout?: number): Promise<ExecResult> {
    if (isLocal) {
      return execLocal(command, timeout);
    }

    const wrappedCommand = `cd /root && ${command}`;

    try {
      const result = await request(
        "POST",
        `/v1/sandboxes/${sandboxId}/exec`,
        { command: wrappedCommand, timeout },
        { idempotencyKey: randomUUID() },
      ) as {
        stdout?: string;
        stderr?: string;
        exit_code?: number;
        exitCode?: number;
      };

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exit_code ?? result.exitCode ?? -1,
      };
    } catch (error: any) {
      if (error?.status === 403) {
        throw new Error(
          "Conway API authentication failed (403). Sandbox exec refused. Command will NOT be executed locally.",
        );
      }

      throw error;
    }
  }

  async function writeFile(filePath: string, content: string): Promise<void> {
    if (isLocal) {
      const resolved = resolveLocalPath(filePath);
      const dir = path.dirname(resolved);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolved, content, "utf-8");
      return;
    }

    await request("POST", `/v1/sandboxes/${sandboxId}/files/upload/json`, {
      path: filePath,
      content,
    });
  }

  async function readFile(filePath: string): Promise<string> {
    if (isLocal) {
      return fs.readFileSync(resolveLocalPath(filePath), "utf-8");
    }

    const result = await request(
      "GET",
      `/v1/sandboxes/${sandboxId}/files/read?path=${encodeURIComponent(filePath)}`,
      undefined,
      { retries404: 0 },
    );

    return typeof result === "string"
      ? result
      : ((result as { content?: string }).content || "");
  }

  async function exposePort(port: number): Promise<PortInfo> {
    if (isLocal) {
      return {
        port,
        publicUrl: `http://localhost:${port}`,
        sandboxId: "local",
      };
    }

    const result = await request(
      "POST",
      `/v1/sandboxes/${sandboxId}/ports/expose`,
      { port },
    ) as {
      port?: number;
      public_url?: string;
      publicUrl?: string;
      url?: string;
    };

    return {
      port: result.port || port,
      publicUrl: result.public_url || result.publicUrl || result.url || "",
      sandboxId,
    };
  }

  async function removePort(port: number): Promise<void> {
    if (isLocal) {
      return;
    }

    await request("DELETE", `/v1/sandboxes/${sandboxId}/ports/${port}`);
  }

  async function createSandbox(options: CreateSandboxOptions): Promise<SandboxInfo> {
    const result = await request("POST", "/v1/sandboxes", {
      name: options.name,
      vcpu: options.vcpu || 1,
      memory_mb: options.memoryMb || 512,
      disk_gb: options.diskGb || 5,
      region: options.region,
    }) as {
      id?: string;
      sandbox_id?: string;
      status?: string;
      region?: string;
      vcpu?: number;
      memory_mb?: number;
      disk_gb?: number;
      terminal_url?: string;
      created_at?: string;
    };

    return {
      id: result.id || result.sandbox_id || "",
      status: result.status || "running",
      region: result.region || "",
      vcpu: result.vcpu || options.vcpu || 1,
      memoryMb: result.memory_mb || options.memoryMb || 512,
      diskGb: result.disk_gb || options.diskGb || 5,
      terminalUrl: result.terminal_url,
      createdAt: result.created_at || new Date().toISOString(),
    };
  }

  async function listSandboxes(): Promise<SandboxInfo[]> {
    const result = await request("GET", "/v1/sandboxes") as
      | Array<Record<string, unknown>>
      | { sandboxes?: Array<Record<string, unknown>> };

    const sandboxes = Array.isArray(result) ? result : result.sandboxes || [];

    return sandboxes.map((sandbox) => ({
      id: String(sandbox.id || sandbox.sandbox_id || ""),
      status: String(sandbox.status || "unknown"),
      region: String(sandbox.region || ""),
      vcpu: Number(sandbox.vcpu || 0),
      memoryMb: Number(sandbox.memory_mb || 0),
      diskGb: Number(sandbox.disk_gb || 0),
      terminalUrl: typeof sandbox.terminal_url === "string" ? sandbox.terminal_url : undefined,
      createdAt: String(sandbox.created_at || ""),
    }));
  }

  async function deleteSandbox(_targetSandboxId: string): Promise<void> {
    return;
  }

  async function getCreditsBalance(): Promise<number> {
    const result = await request("GET", "/v1/credits/balance") as {
      balance_cents?: number;
      credits_cents?: number;
    };

    return result.balance_cents ?? result.credits_cents ?? 0;
  }

  async function getCreditsPricing(): Promise<PricingTier[]> {
    const result = await request("GET", "/v1/credits/pricing") as {
      tiers?: Array<Record<string, unknown>>;
      pricing?: Array<Record<string, unknown>>;
    };

    const tiers = result.tiers || result.pricing || [];

    return tiers.map((tier) => ({
      name: String(tier.name || ""),
      vcpu: Number(tier.vcpu || 0),
      memoryMb: Number(tier.memory_mb || 0),
      diskGb: Number(tier.disk_gb || 0),
      monthlyCents: Number(tier.monthly_cents || 0),
    }));
  }

  async function transferCredits(
    toAddress: string,
    amountCents: number,
    note?: string,
  ): Promise<CreditTransferResult> {
    const payload = {
      to_address: toAddress,
      amount_cents: amountCents,
      note,
    };
    const result = await request("POST", "/v1/credits/transfer", payload, {
      idempotencyKey: randomUUID(),
    }) as {
      transfer_id?: string;
      id?: string;
      status?: string;
      to_address?: string;
      amount_cents?: number;
      balance_after_cents?: number;
      new_balance_cents?: number;
    };

    return {
      transferId: String(result.transfer_id || result.id || ""),
      status: String(result.status || "submitted"),
      toAddress: String(result.to_address || toAddress),
      amountCents: Number(result.amount_cents ?? amountCents),
      balanceAfterCents: result.balance_after_cents ?? result.new_balance_cents,
    };
  }

  async function registerAutomaton(params: {
    automatonId: string;
    automatonAddress: string;
    creatorAddress: string;
    name: string;
    bio?: string;
    genesisPromptHash?: `0x${string}`;
    account: PrivateKeyAccount;
    nonce?: string;
    chainType?: ChainType;
    chainIdentity?: ChainIdentity;
  }): Promise<{ automaton: Record<string, unknown> }> {
    const {
      automatonId,
      automatonAddress,
      creatorAddress,
      name,
      bio,
      genesisPromptHash,
      account,
      chainIdentity,
    } = params;

    const nonce = params.nonce ?? randomUUID();
    const isSolana = params.chainType === "solana";

    const payload: Record<string, string> = {
      automaton_id: automatonId,
      automaton_address: automatonAddress,
      creator_address: creatorAddress,
      name,
      bio: bio || "",
    };

    if (genesisPromptHash) {
      payload.genesis_prompt_hash = genesisPromptHash;
    }

    const payloadHash = hashIdentityPayload(payload);
    let signature: string;

    if (isSolana && chainIdentity) {
      const signatureMessage = JSON.stringify({ automatonId, nonce, payloadHash });
      signature = await chainIdentity.signMessage(signatureMessage);
    } else if (isSolana && !chainIdentity) {
      throw new Error("Solana registration requires chainIdentity.");
    } else {
      const domain = {
        name: "AIWS Automaton",
        version: "1",
        chainId: 8453,
      };

      const types = {
        Register: [
          { name: "automatonId", type: "string" },
          { name: "nonce", type: "string" },
          { name: "payloadHash", type: "bytes32" },
        ],
      };

      const message = {
        automatonId,
        nonce,
        payloadHash,
      };

      signature = await account.signTypedData({
        domain,
        types,
        primaryType: "Register",
        message,
      });
    }

    const body: Record<string, unknown> = {
      automaton_id: automatonId,
      automaton_address: automatonAddress,
      creator_address: creatorAddress,
      name,
      bio: bio || "",
      nonce,
      signature,
      payload_hash: payloadHash,
    };

    if (genesisPromptHash) {
      body.genesis_prompt_hash = genesisPromptHash;
    }

    if (isSolana) {
      body.chain_type = "solana";
    }

    return request("POST", "/v1/automatons/register", body) as Promise<{ automaton: Record<string, unknown> }>;
  }

  async function searchDomains(query: string, tlds?: string): Promise<DomainSearchResult[]> {
    const params = new URLSearchParams({ query });
    if (tlds) {
      params.set("tlds", tlds);
    }

    const result = await request("GET", `/v1/domains/search?${params.toString()}`) as {
      results?: Array<Record<string, unknown>>;
      domains?: Array<Record<string, unknown>>;
    };

    const domains = result.results || result.domains || [];

    return domains.map((domain) => ({
      domain: String(domain.domain || ""),
      available: Boolean(domain.available ?? domain.purchasable ?? false),
      registrationPrice: typeof domain.registration_price === "number"
        ? domain.registration_price
        : typeof domain.purchase_price === "number"
          ? domain.purchase_price
          : undefined,
      renewalPrice: typeof domain.renewal_price === "number" ? domain.renewal_price : undefined,
      currency: String(domain.currency || "USD"),
    }));
  }

  async function registerDomain(domain: string, years: number = 1): Promise<DomainRegistration> {
    const result = await request("POST", "/v1/domains/register", {
      domain,
      years,
    }) as {
      domain?: string;
      status?: string;
      expires_at?: string;
      expiry?: string;
      transaction_id?: string;
      id?: string;
    };

    return {
      domain: String(result.domain || domain),
      status: String(result.status || "registered"),
      expiresAt: typeof result.expires_at === "string"
        ? result.expires_at
        : typeof result.expiry === "string"
          ? result.expiry
          : undefined,
      transactionId: typeof result.transaction_id === "string"
        ? result.transaction_id
        : typeof result.id === "string"
          ? result.id
          : undefined,
    };
  }

  async function listDnsRecords(domain: string): Promise<DnsRecord[]> {
    const result = await request(
      "GET",
      `/v1/domains/${encodeURIComponent(domain)}/dns`,
    ) as { records?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

    const records = Array.isArray(result) ? result : result.records || [];

    return records.map((record) => ({
      id: String(record.id || record.record_id || ""),
      type: String(record.type || ""),
      host: String(record.host || record.name || ""),
      value: String(record.value || record.answer || ""),
      ttl: typeof record.ttl === "number" ? record.ttl : undefined,
      distance: typeof record.distance === "number"
        ? record.distance
        : typeof record.priority === "number"
          ? record.priority
          : undefined,
    }));
  }

  async function addDnsRecord(
    domain: string,
    type: string,
    host: string,
    value: string,
    ttl?: number,
  ): Promise<DnsRecord> {
    const result = await request(
      "POST",
      `/v1/domains/${encodeURIComponent(domain)}/dns`,
      { type, host, value, ttl: ttl || 3600 },
    ) as {
      id?: string;
      record_id?: string;
      type?: string;
      host?: string;
      value?: string;
      ttl?: number;
    };

    return {
      id: String(result.id || result.record_id || ""),
      type: String(result.type || type),
      host: String(result.host || host),
      value: String(result.value || value),
      ttl: typeof result.ttl === "number" ? result.ttl : ttl || 3600,
    };
  }

  async function deleteDnsRecord(domain: string, recordId: string): Promise<void> {
    await request(
      "DELETE",
      `/v1/domains/${encodeURIComponent(domain)}/dns/${encodeURIComponent(recordId)}`,
    );
  }

  async function listModels(): Promise<ModelInfo[]> {
    const urls = [
      "https://inference.conway.tech/v1/models",
      `${options.apiUrl}/v1/models`,
    ];

    for (const url of urls) {
      try {
        const response = await httpClient.request(url, {
          headers: { Authorization: options.apiKey },
        });

        if (!response.ok) {
          continue;
        }

        const result = await response.json() as {
          data?: Array<Record<string, unknown>>;
          models?: Array<Record<string, unknown>>;
        };
        const raw = result.data || result.models || [];

        return raw
          .filter((model) => model.available !== false)
          .map((model) => ({
            id: String(model.id || ""),
            provider: String(model.provider || model.owned_by || "unknown"),
            pricing: {
              inputPerMillion: Number(
                model.pricing && typeof model.pricing === "object"
                  ? ((model.pricing as Record<string, unknown>).input_per_million ??
                    (model.pricing as Record<string, unknown>).input_per_1m_tokens_usd ??
                    0)
                  : 0,
              ),
              outputPerMillion: Number(
                model.pricing && typeof model.pricing === "object"
                  ? ((model.pricing as Record<string, unknown>).output_per_million ??
                    (model.pricing as Record<string, unknown>).output_per_1m_tokens_usd ??
                    0)
                  : 0,
              ),
            },
          }));
      } catch {
        continue;
      }
    }

    return [];
  }

  function createScopedClient(targetSandboxId: string): ConwayClient {
    return createConwayClient({
      apiUrl,
      apiKey,
      sandboxId: targetSandboxId,
    });
  }

  return {
    exec,
    writeFile,
    readFile,
    exposePort,
    removePort,
    createSandbox,
    listSandboxes,
    deleteSandbox,
    getCreditsBalance,
    getCreditsPricing,
    transferCredits,
    registerAutomaton,
    searchDomains,
    registerDomain,
    listDnsRecords,
    addDnsRecord,
    deleteDnsRecord,
    listModels,
    createScopedClient,
  };
}

export function execLocal(command: string, timeout?: number): ExecResult {
  try {
    const stdout = execSync(command, {
      timeout: timeout || 30_000,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      cwd: process.env.HOME || "/root",
    });

    return {
      stdout: stdout || "",
      stderr: "",
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      exitCode: error.status ?? 1,
    };
  }
}
