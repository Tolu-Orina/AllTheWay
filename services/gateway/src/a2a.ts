import {
  ClientFactory,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  type Client,
} from "@a2a-js/sdk/client";
import { GoogleAuth } from "google-auth-library";

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
 *
 * ## Every call carries a Google-signed OIDC identity token
 *
 * This is Phase 1 item 1.4, and it is not optional hardening — without it the
 * deployed system does not work at all. Internal services run with
 * INGRESS_TRAFFIC_INTERNAL_ONLY and `run.invoker` granted per caller service
 * account, so Cloud Run rejects any request that arrives without a valid token.
 * Locally nothing requires auth, which is exactly why this was invisible until
 * there was a real project.
 *
 * Verification is Cloud Run's, deliberately. It checks the signature, issuer and
 * audience and enforces IAM *before* the request reaches this process — which is
 * strictly stronger than checking it in application code, and means the A2A
 * layer and the IAM layer agree rather than duplicating. The card's
 * `HTTPAuthSecurityScheme` (bearer) is an honest description of that.
 *
 * The audience is the callee's base URL, which is what Cloud Run expects and why
 * a token is minted per target rather than once globally.
 */
const clients = new Map<string, Promise<Client>>();

/** One instance: it caches the metadata-server lookup for the environment. */
const auth = new GoogleAuth();

/**
 * A `fetch` that attaches an identity token for `audience`.
 *
 * Falls through to an unauthenticated request when no token can be minted.
 * That is the correct behaviour rather than a silent weakening: in development
 * there is no metadata server and the local services require nothing, while in
 * production Cloud Run rejects the unauthenticated request anyway. Failing hard
 * here would break every local run to defend a boundary the platform already
 * defends.
 */
export function authenticatingFetch(audience: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);

    if (!headers.has("authorization")) {
      try {
        const token = await (await auth.getIdTokenClient(audience)).idTokenProvider.fetchIdToken(
          audience,
        );
        headers.set("authorization", `Bearer ${token}`);
      } catch (err) {
        // Logged once per call rather than swallowed: if this starts happening
        // in production, every downstream call is about to 403 and the cause
        // should be in the logs already.
        if (env.production) {
          console.warn(`[a2a] no identity token for ${audience}: ${(err as Error).message}`);
        }
      }
    }

    return fetch(input, { ...init, headers });
  };
}

export function agentClient(baseUrl: string): Promise<Client> {
  let client = clients.get(baseUrl);
  if (!client) {
    const fetchImpl = authenticatingFetch(baseUrl);

    const factory = new ClientFactory({
      // JSON-RPC only. gRPC would be faster between internal services, but every
      // agent must speak it and our Python side publishes JSONRPC today — adding
      // a transport we cannot serve would just mean silent fallbacks.
      //
      // The A2A-Version header is set by the transport from the AgentInterface
      // matched in the card, so version negotiation is not our concern here.
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      // The card fetch needs the token too: it is a request to the same
      // internal-only service, and it happens before any RPC.
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    });

    client = factory.createFromUrl(baseUrl);
    // Do not cache a rejected promise: a card fetch that failed because the
    // agent was still starting must not poison every later call.
    client.catch(() => clients.delete(baseUrl));
    clients.set(baseUrl, client);
  }
  return client;
}

export const orchestratorClient = () => agentClient(env.orchestratorUrl);
