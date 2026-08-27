import { GoogleAuth } from "google-auth-library";

import { env } from "../env.js";

/**
 * Screening, asked of the orchestrator.
 *
 * The same arrangement the scribe uses: there is one screener, it is Python,
 * and services that are not Python ask it rather than growing a second copy of
 * the one control that must not drift.
 *
 * ## Unreachable means blocked
 *
 * Every failure path returns `false`. A second opinion that cannot be obtained
 * is not a second opinion that said yes — and here the cost of being wrong is a
 * reasoning model with web search reading an instruction planted by whoever was
 * loudest in the meeting.
 */

const auth = new GoogleAuth();

export async function screened(text: string): Promise<boolean> {
  const url = env.orchestratorUrl;
  if (!url) return false;

  try {
    const client = await auth.getIdTokenClient(url);
    const response = await client.request<{ allowed?: boolean }>({
      url: `${url}/screen`,
      method: "POST",
      data: { text, direction: "inbound" },
      timeout: 30_000,
      validateStatus: () => true,
    });

    if (response.status !== 200) return false;
    return response.data?.allowed === true;
  } catch {
    return false;
  }
}
