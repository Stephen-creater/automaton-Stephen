export type SiwsMessage = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  nonce: string;
  issuedAt: string;
  chainId: string;
};

export function buildSiwsMessage(params: SiwsMessage): string {
  return `${params.domain} wants you to sign in with your Solana account:
${params.address}

${params.statement}

URI: ${params.uri}
Nonce: ${params.nonce}
Issued At: ${params.issuedAt}
Chain ID: ${params.chainId}`;
}
