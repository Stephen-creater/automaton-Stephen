import { getAutomatonDir } from "./wallet.js";
import fs from "fs";
import path from "path";
import { SiweMessage } from "siwe";
import { getWallet } from "./wallet.js";
import { buildSiwsMessage } from "./siws.js";
import type { ChainIdentity } from "./chain.js";
import type { ProvisionResult } from "../types.js";

const DEFAULT_API_URL = "https://api.conway.tech";

export function loadApiKeyFromConfig(): string | null {
  const configPath = path.join(getAutomatonDir(), "config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const data = JSON.parse(raw) as { apiKey?: string };
    return data.apiKey?.trim() || null;
  } catch {
    return null;
  }
}

function saveApiKeyToConfig(apiKey: string, walletAddress: string): void {
  const configPath = path.join(getAutomatonDir(), "config.json");
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        apiKey,
        walletAddress,
        provisionedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

export async function provision(
  apiUrl?: string,
  solanaIdentity?: ChainIdentity,
): Promise<ProvisionResult> {
  const url = apiUrl || process.env.CONWAY_API_URL || DEFAULT_API_URL;
  const { account, chainIdentity } = getWallet();
  const identity = solanaIdentity || chainIdentity;

  const nonceResp = await fetch(`${url}/v1/auth/nonce`, {
    method: "POST",
  });

  if (!nonceResp.ok) {
    throw new Error(`Failed to get nonce: ${nonceResp.status} ${await nonceResp.text()}`);
  }

  const { nonce } = await nonceResp.json() as { nonce: string };

  const isSolana = identity.chainType === "solana";
  const message = isSolana
    ? buildSiwsMessage({
        domain: "conway.tech",
        address: identity.address,
        statement: "Sign in to Conway as an Automaton to provision an API key.",
        uri: `${url}/v1/auth/verify`,
        nonce,
        issuedAt: new Date().toISOString(),
        chainId: "mainnet",
      })
    : new SiweMessage({
        domain: "conway.tech",
        address: identity.address,
        statement: "Sign in to Conway as an Automaton to provision an API key.",
        uri: `${url}/v1/auth/verify`,
        version: "1",
        chainId: 8453,
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();

  const signature = isSolana
    ? await identity.signMessage(message)
    : await account!.signMessage({ message });

  const verifyBody: Record<string, string> = { message, signature };
  if (isSolana) {
    verifyBody.chain_type = "solana";
  }

  const verifyResp = await fetch(`${url}/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verifyBody),
  });

  if (!verifyResp.ok) {
    const protocol = isSolana ? "SIWS" : "SIWE";
    throw new Error(`${protocol} verification failed: ${verifyResp.status} ${await verifyResp.text()}`);
  }

  const { access_token } = await verifyResp.json() as { access_token: string };

  const keyResp = await fetch(`${url}/v1/auth/api-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ name: "conway-automaton" }),
  });

  if (!keyResp.ok) {
    throw new Error(`Failed to create API key: ${keyResp.status} ${await keyResp.text()}`);
  }

  const { key, key_prefix } = await keyResp.json() as {
    key: string;
    key_prefix: string;
  };

  saveApiKeyToConfig(key, identity.address);

  return {
    apiKey: key,
    walletAddress: identity.address,
    keyPrefix: key_prefix,
  };
}
