import type { PrivateKeyAccount } from "viem";
import nacl from "tweetnacl";
import bs58 from "bs58";

export type ChainType = "evm" | "solana";

export interface ChainIdentity {
  readonly chainType: ChainType;
  readonly address: string;
  signMessage(message: string): Promise<string>;
}

export function isValidAddress(address: string, chainType: ChainType): boolean {
  if (chainType === "solana") {
    try {
      const decoded = bs58.decode(address);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }

  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export class EvmChainIdentity implements ChainIdentity {
  readonly chainType: ChainType = "evm";
  readonly address: string;
  readonly account: PrivateKeyAccount;

  constructor(account: PrivateKeyAccount) {
    this.account = account;
    this.address = account.address;
  }

  async signMessage(message: string): Promise<string> {
    return this.account.signMessage({ message });
  }
}

export class SolanaChainIdentity implements ChainIdentity {
  readonly chainType: ChainType = "solana";
  readonly address: string;
  private readonly keypair: nacl.SignKeyPair;

  constructor(secretKey: Uint8Array) {
    this.keypair = nacl.sign.keyPair.fromSecretKey(secretKey);
    this.address = bs58.encode(this.keypair.publicKey);
  }

  async signMessage(message: string): Promise<string> {
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    return bs58.encode(signature);
  }

  getSecretKey(): Uint8Array {
    return this.keypair.secretKey;
  }
}
