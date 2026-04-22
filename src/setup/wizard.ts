import fs from "fs";
import path from "path";
import chalk from "chalk";
import { writeDefaultHeartbeatConfig } from "../heartbeat/config.js";
import { provision } from "../identity/provision.js";
import { getAutomatonDir, getWallet } from "../identity/wallet.js";
import type { ChainType } from "../identity/chain.js";
import { createConfig, saveConfig } from "../config.js";
import { DEFAULT_TREASURY_POLICY } from "../types.js";
import type { AutomatonConfig, TreasuryPolicy } from "../types.js";
import { showBanner } from "./banner.js";
import { generateSoulMd, installDefaultSkills } from "./defaults.js";
import { detectEnvironment } from "./environment.js";
import {
  closePrompts,
  promptMultiline,
  promptOptional,
  promptRequired,
  promptWithDefault,
} from "./prompts.js";

export type SetupDraft = AutomatonConfig;

export async function runSetupWizard(): Promise<SetupDraft> {
  try {
    showBanner();
    console.log(chalk.white("  First-run setup. Let's bring your automaton to life.\n"));

    showStep("1/6", "Select chain type");
    const selectedChainType = await selectChainType();

    showStep("2/6", "Prepare wallet");
    const { chainType, walletAddress } = await prepareWallet(selectedChainType);

    showStep("3/6", "Provision Conway API key");
    const conwayApiKey = await provisionApiKey();

    showStep("4/6", "Collect setup profile");
    const profile = await collectSetupProfile(chainType);
    const providers = await collectProviderConfig();
    const treasuryPolicy = await collectTreasuryPolicy();
    const environment = detectEnvironment();
    printEnvironmentSummary(environment);
    const draft: SetupDraft = createConfig({
      name: profile.name,
      genesisPrompt: profile.genesisPrompt,
      creatorAddress: profile.creatorAddress,
      registeredWithConway: !!conwayApiKey,
      sandboxId: environment.sandboxId,
      walletAddress,
      conwayApiKey,
      openaiApiKey: providers.openaiApiKey,
      anthropicApiKey: providers.anthropicApiKey,
      ollamaBaseUrl: providers.ollamaBaseUrl,
      treasuryPolicy,
      chainType,
    });

    showStep("5/6", "Write setup files");
    saveConfig(draft);
    writeDefaultHeartbeatConfig();
    writeSoulFile(draft);
    installConstitution();
    installDefaultSkills(draft.skillsDir || "~/.automaton/skills");

    showStep("6/6", "Show funding guide");
    showFundingGuide(walletAddress);

    return draft;
  } finally {
    closePrompts();
  }
}

async function selectChainType(): Promise<ChainType> {
  const input = await promptOptional("Choose chain type: evm or solana [evm]: ");
  const normalized = input.trim().toLowerCase();

  if (normalized === "solana") {
    return "solana";
  }

  return "evm";
}

async function prepareWallet(chainType: ChainType): Promise<{
  chainType: ChainType;
  walletAddress: string;
}> {
  const result = getWallet(chainType);

  if (!result.isNew && result.chainType !== chainType) {
    console.log(
      `Using existing ${result.chainType} wallet from wallet.json instead of creating a new ${chainType} wallet.`,
    );
  }

  return {
    chainType: result.chainType,
    walletAddress: result.chainIdentity.address,
  };
}

async function provisionApiKey(): Promise<string | undefined> {
  try {
    const result = await provision();
    console.log(`Conway API key provisioned: ${result.keyPrefix}...`);
    return result.apiKey;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provisioning error";
    console.log(`Automatic provisioning failed: ${message}`);
    console.log("You can enter a Conway API key manually, or press Enter to skip.");
  }

  const input = await promptOptional("Enter Conway API key (optional, press Enter to skip): ");
  const normalized = input.trim();

  if (!normalized) {
    return undefined;
  }

  if (!looksLikeConwayApiKey(normalized)) {
    console.log("Warning: this key does not look like a Conway API key, but it will still be saved.");
  }

  saveProvisionedApiKey(normalized);

  return normalized;
}

function saveProvisionedApiKey(apiKey: string): void {
  const automatonDir = getAutomatonDir();
  if (!fs.existsSync(automatonDir)) {
    fs.mkdirSync(automatonDir, { recursive: true, mode: 0o700 });
  }

  const configPath = path.join(automatonDir, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        apiKey,
        provisionedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function writeSoulFile(config: SetupDraft): void {
  const soulPath = path.join(getAutomatonDir(), "SOUL.md");
  fs.writeFileSync(
    soulPath,
    generateSoulMd(
      config.name,
      config.walletAddress,
      config.creatorAddress,
      config.genesisPrompt,
    ),
    { mode: 0o600 },
  );
}

function installConstitution(): void {
  const constitutionSrc = path.join(process.cwd(), "constitution.md");
  if (!fs.existsSync(constitutionSrc)) {
    return;
  }

  const constitutionDst = path.join(getAutomatonDir(), "constitution.md");
  fs.copyFileSync(constitutionSrc, constitutionDst);
  fs.chmodSync(constitutionDst, 0o444);
}

function showFundingGuide(walletAddress: string): void {
  console.log("");
  console.log("Setup complete.");
  console.log(`Wallet address: ${walletAddress}`);
  console.log("Next step: fund this wallet so the automaton can operate.");
}

function showStep(step: string, label: string): void {
  console.log("");
  console.log(`[${step}] ${label}`);
}

async function collectSetupProfile(chainType: ChainType): Promise<{
  name: string;
  genesisPrompt: string;
  creatorAddress: string;
}> {
  const name = await promptRequired("Choose automaton name: ");
  const genesisPrompt = await promptMultiline("Enter genesis prompt");
  const creatorAddress = await promptCreatorAddress(chainType);

  return {
    name: name.trim(),
    genesisPrompt: genesisPrompt.trim(),
    creatorAddress: creatorAddress.trim(),
  };
}

async function collectProviderConfig(): Promise<{
  openaiApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
}> {
  console.log(chalk.white("  Optional: bring your own inference provider keys (press Enter to skip)."));
  const openaiApiKey = await promptOptional("OpenAI API key (sk-..., optional)");
  if (openaiApiKey && !openaiApiKey.startsWith("sk-")) {
    console.log(chalk.yellow("  Warning: OpenAI keys usually start with sk-. Saving anyway."));
  }

  const anthropicApiKey = await promptOptional("Anthropic API key (sk-ant-..., optional)");
  if (anthropicApiKey && !anthropicApiKey.startsWith("sk-ant-")) {
    console.log(chalk.yellow("  Warning: Anthropic keys usually start with sk-ant-. Saving anyway."));
  }

  const ollamaInput = await promptOptional("Ollama base URL (http://localhost:11434, optional)");
  const ollamaBaseUrl = ollamaInput || undefined;

  if (openaiApiKey || anthropicApiKey || ollamaBaseUrl) {
    const providers = [
      openaiApiKey ? "OpenAI" : null,
      anthropicApiKey ? "Anthropic" : null,
      ollamaBaseUrl ? "Ollama" : null,
    ].filter(Boolean).join(", ");
    console.log(chalk.green(`  Provider keys/URLs saved: ${providers}\n`));
  } else {
    console.log(chalk.dim("  No provider keys set. Inference will default to Conway.\n"));
  }

  return {
    openaiApiKey: openaiApiKey || undefined,
    anthropicApiKey: anthropicApiKey || undefined,
    ollamaBaseUrl,
  };
}

async function collectTreasuryPolicy(): Promise<TreasuryPolicy> {
  console.log(chalk.cyan("  Financial Safety Policy"));
  console.log(chalk.dim("  These limits protect against unauthorized spending. Press Enter for defaults.\n"));

  const treasuryPolicy: TreasuryPolicy = {
    maxSingleTransferCents: await promptWithDefault(
      "Max single transfer (cents)",
      DEFAULT_TREASURY_POLICY.maxSingleTransferCents,
    ),
    maxHourlyTransferCents: await promptWithDefault(
      "Max hourly transfers (cents)",
      DEFAULT_TREASURY_POLICY.maxHourlyTransferCents,
    ),
    maxDailyTransferCents: await promptWithDefault(
      "Max daily transfers (cents)",
      DEFAULT_TREASURY_POLICY.maxDailyTransferCents,
    ),
    minimumReserveCents: await promptWithDefault(
      "Minimum reserve (cents)",
      DEFAULT_TREASURY_POLICY.minimumReserveCents,
    ),
    maxX402PaymentCents: await promptWithDefault(
      "Max x402 payment (cents)",
      DEFAULT_TREASURY_POLICY.maxX402PaymentCents,
    ),
    x402AllowedDomains: DEFAULT_TREASURY_POLICY.x402AllowedDomains,
    transferCooldownMs: DEFAULT_TREASURY_POLICY.transferCooldownMs,
    maxTransfersPerTurn: DEFAULT_TREASURY_POLICY.maxTransfersPerTurn,
    maxInferenceDailyCents: await promptWithDefault(
      "Max daily inference spend (cents)",
      DEFAULT_TREASURY_POLICY.maxInferenceDailyCents,
    ),
    requireConfirmationAboveCents: await promptWithDefault(
      "Require confirmation above (cents)",
      DEFAULT_TREASURY_POLICY.requireConfirmationAboveCents,
    ),
  };

  console.log(chalk.green("  Treasury policy configured.\n"));
  return treasuryPolicy;
}

async function promptCreatorAddress(chainType: ChainType): Promise<string> {
  while (true) {
    const answer = await promptRequired("Enter creator wallet address: ");

    if (isValidCreatorAddress(answer, chainType)) {
      return answer;
    }

    console.log(`Please enter a valid ${chainType.toUpperCase()} wallet address.`);
  }
}

function isValidCreatorAddress(value: string, chainType: ChainType): boolean {
  if (chainType === "solana") {
    return isLikelySolanaAddress(value);
  }

  return isValidEvmAddress(value);
}

function looksLikeConwayApiKey(value: string): boolean {
  return /^cnwy_[a-zA-Z0-9_]+$/.test(value);
}

function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function printEnvironmentSummary(environment: { type: string; sandboxId: string }): void {
  if (environment.sandboxId) {
    console.log(chalk.green(`  Conway sandbox detected: ${environment.sandboxId}\n`));
  } else {
    console.log(chalk.dim(`  Environment: ${environment.type} (no sandbox detected)\n`));
  }
}
