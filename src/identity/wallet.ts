import fs from "fs";
import path from "path";
import type { Hex, PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import nacl from "tweetnacl";
import bs58 from "bs58";
import type { ChainIdentity, ChainType } from "./chain.js";
import { EvmChainIdentity, SolanaChainIdentity } from "./chain.js";

export type LocalWalletData = {
  chainType: ChainType;
  createdAt: string;
  privateKey?: string;
  secretKey?: string;
};

export type WalletResult = {
  account: PrivateKeyAccount | null;
  chainIdentity: ChainIdentity;
  chainType: ChainType;
  isNew: boolean;
};

export function getAutomatonDir(): string {
  return path.join(process.env.HOME || "/root", ".automaton");
}

export function getWalletPath(): string {
  return path.join(getAutomatonDir(), "wallet.json");
}

export function getWallet(chainType: ChainType = "evm"): WalletResult {
  const walletPath = getWalletPath();
  const existingWallet = loadWallet(walletPath);

  if (existingWallet) {
    return buildWalletResult(existingWallet, false);
  }

  const wallet = chainType === "solana"
    ? createSolanaWallet()
    : createEvmWallet();

  const dir = path.dirname(walletPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(walletPath, JSON.stringify(wallet, null, 2));
  return buildWalletResult(wallet, true);
}

function createEvmWallet(): LocalWalletData {
  const privateKey = generatePrivateKey();

  return {
    chainType: "evm",
    createdAt: new Date().toISOString(),
    privateKey,
  };
}

function createSolanaWallet(): LocalWalletData {
  const keypair = nacl.sign.keyPair();

  return {
    chainType: "solana",
    createdAt: new Date().toISOString(),
    secretKey: bs58.encode(keypair.secretKey),
  };
}

function buildWalletResult(wallet: LocalWalletData, isNew: boolean): WalletResult {
  if (wallet.chainType === "solana") {
    if (!wallet.secretKey) {
      throw new Error("Solana wallet is missing secret key.");
    }

    const secretKey = bs58.decode(wallet.secretKey);
    const chainIdentity = new SolanaChainIdentity(secretKey);
    return {
      account: null,
      chainIdentity,
      chainType: "solana",
      isNew,
    };
  }

  if (!wallet.privateKey) {
    throw new Error("EVM wallet is missing private key.");
  }

  const account = privateKeyToAccount(wallet.privateKey as Hex);
  return {
    account,
    chainIdentity: new EvmChainIdentity(account),
    chainType: "evm",
    isNew,
  };
}

function loadWallet(walletPath: string): LocalWalletData | null {
  if (!fs.existsSync(walletPath)) {
    return null;
  }

  const raw = fs.readFileSync(walletPath, "utf8");
  return JSON.parse(raw) as LocalWalletData;
}
