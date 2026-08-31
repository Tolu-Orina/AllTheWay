import { authenticatingFetch } from "../a2a.js";
import { env } from "../env.js";
import type { ActiveHat } from "../hat.js";
import { scopeHeader, scopeTokenConfigured } from "../scope.js";

/**
 * Retrieval for a turn.
 *
 * The gateway retrieves and hands passages to the orchestrator, rather than
 * the orchestrator retrieving for itself. Three reasons, in order of weight:
 *
 * 1. **Only the gateway can mint a scope token.** That is layer 4 of the
 *    cross-user isolation defence, enforced by IAM rather than by convention.
 *    Relaying a token through the orchestrator would place it inside the
 *    isolation boundary — precisely what layer 4 exists to prevent.
 * 2. **The orchestrator is stateless by design.** Firestore access was
 *    withheld from it on purpose; handing it a credential that reads the
 *    user's documents would quietly undo that.
 * 3. **This pattern already exists.** `knownPreferences` travels exactly this
 *    way, for exactly this reason.
 *
 * The cost is that retrieval runs on the user's message rather than on
 * something the model has reasoned about first. That is ordinary RAG, and it
 * is what §2's cases need.
 *
 * ## Failure is empty, not fatal
 *
 * A turn whose retrieval failed should still answer — from the conversation,
 * without citations, and saying so. Failing the whole turn because the
 * document service is unavailable would make every conversation hostage to a
 * feature the user may not even be using.
 *
 * What must *not* happen is a claim that appears grounded when nothing was
 * retrieved. That is prevented downstream by the citation check, not here.
 */

export type Passage = {
  chunkId: string;
  documentId: string;
  title: string;
  page: number;
  text: string;
};

const AUDIENCE = "librarian";
const TIMEOUT_MS = 20_000;

//: Six passages is roughly two pages of context — enough to answer a question
//: about a clause, small enough that the prompt stays mostly the user's.
const DEFAULT_LIMIT = 6;

export const retrievalConfigured = (): boolean =>
  Boolean(env.librarianUrl) && scopeTokenConfigured();

export async function retrieve(
  uid: string,
  query: string,
  opts: { limit?: number; hat?: ActiveHat; documentIds?: string[] } = {},
): Promise<Passage[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!retrievalConfigured() || !query.trim()) return [];

  try {
    const fetchImpl = authenticatingFetch(env.librarianUrl);
    const documentIds = (opts.documentIds ?? []).filter(Boolean).slice(0, 5);
    const response = await fetchImpl(`${env.librarianUrl}/retrieve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The uid never travels in the body. It travels signed, and the
        // librarian reads it from there.
        ...scopeHeader(uid, AUDIENCE),
      },
      body: JSON.stringify({
        query,
        limit,
        ...(opts.hat ? { hat: opts.hat } : {}),
        ...(documentIds.length ? { documentIds } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[retrieval] librarian returned HTTP ${response.status}`);
      return [];
    }

    const body = (await response.json()) as { passages?: Passage[] };
    return Array.isArray(body.passages) ? body.passages : [];
  } catch (err) {
    // Logged, not raised. A conversation should survive its document service
    // being unavailable.
    console.warn(`[retrieval] ${(err as Error).message}`);
    return [];
  }
}
