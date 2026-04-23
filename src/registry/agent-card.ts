import type {
  AgentCard,
  AgentService,
  AutomatonConfig,
  AutomatonIdentity,
  AutomatonDatabase,
  ConwayClient,
} from "../types.js";

const AGENT_CARD_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export function generateAgentCard(
  identity: AutomatonIdentity,
  config: AutomatonConfig,
  _db: AutomatonDatabase,
): AgentCard {
  const chainType = config.chainType || identity.chainType || "evm";
  const walletEndpoint = chainType === "solana"
    ? `solana:mainnet:${identity.address}`
    : `eip155:8453:${identity.address}`;

  const services: AgentService[] = [
    {
      name: "agentWallet",
      endpoint: walletEndpoint,
    },
  ];

  return {
    type: AGENT_CARD_TYPE,
    name: config.name,
    description: `Autonomous agent: ${config.name}`,
    services,
    x402Support: chainType !== "solana",
    active: true,
  };
}

export function serializeAgentCard(card: AgentCard): string {
  return JSON.stringify(card, null, 2);
}

export async function hostAgentCard(
  card: AgentCard,
  conway: ConwayClient,
  port: number = 8004,
): Promise<string> {
  const cardJson = serializeAgentCard(card);
  await conway.writeFile("/tmp/agent-card.json", cardJson);

  const serverScript = `
const http = require('http');
const fs = require('fs');
const path = '/tmp/agent-card.json';
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.url === '/.well-known/agent-card.json' || req.url === '/agent-card.json') {
    try {
      const data = fs.readFileSync(path, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});
server.listen(${port}, () => console.log('Agent card server on port ' + ${port}));
`;

  await conway.writeFile("/tmp/agent-card-server.js", serverScript);
  await conway.exec(`node /tmp/agent-card-server.js &`, 5000);
  const portInfo = await conway.exposePort(port);
  return `${portInfo.publicUrl}/.well-known/agent-card.json`;
}

export async function saveAgentCard(
  card: AgentCard,
  conway: ConwayClient,
): Promise<void> {
  const cardJson = serializeAgentCard(card);
  const home = process.env.HOME || "/root";
  await conway.writeFile(`${home}/.automaton/agent-card.json`, cardJson);
}
