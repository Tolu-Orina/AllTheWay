import { ClientFactory, JsonRpcTransportFactory, type Client } from "@a2a-js/sdk/client";

import { env } from "./env.js";

/**
 * A2A clients, resolved from each agent's published card.
 *
 * The gateway never hardcodes an agent's URL shape or method names — it fetches
 * `/.well-known/agent-card.json` and lets the card decide the transport and
 * protocol version. That is the point of A2A: adding a new agent is publishing
 * a card, not editing the caller.
 *
 * Clients are cached because card resolution is a network round-trip; the cache
 * is per-process and dies with the container, so a redeployed agent's new card
 * is picked up on the next cold start.
 */
const clients = new Map<string, Promise<Client>>();

function factory(): ClientFactory {
  return new ClientFactory({
    // JSON-RPC only. gRPC would be faster between internal services, but every
    // agent must speak it and our Python side publishes JSONRPC today — adding
    // a transport we cannot serve would just mean silent fallbacks.
    transports: [new JsonRpcTransportFactory()],
  });
}

export function agentClient(baseUrl: string): Promise<Client> {
  let client = clients.get(baseUrl);
  if (!client) {
    // The A2A-Version header is set by the transport from the AgentInterface
    // matched in the card, so version negotiation is not our concern here.
    client = factory().createFromUrl(baseUrl);
    // Do not cache a rejected promise: a card fetch that failed because the
    // agent was still starting must not poison every later call.
    client.catch(() => clients.delete(baseUrl));
    clients.set(baseUrl, client);
  }
  return client;
}

export const orchestratorClient = () => agentClient(env.orchestratorUrl);
