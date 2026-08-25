import { PubSub } from "@google-cloud/pubsub";

import { env } from "./env.js";

/**
 * Publishes domain events.
 *
 * The emulator is picked up automatically from PUBSUB_EMULATOR_HOST, so this
 * file has no environment branching. Topics are created by Terraform in a real
 * project; locally they are created by scripts-events.py.
 */
const pubsub = new PubSub({ projectId: env.projectId });

export const TOPICS = {
  sessionEnded: "session-ended",
  watcherTrigger: "watcher-trigger",
} as const;

export async function publish(topic: string, payload: unknown): Promise<string | null> {
  try {
    return await pubsub.topic(topic).publishMessage({ json: payload });
  } catch (err) {
    // A failed publish must not fail the user's request: the session really did
    // end. It is logged and dropped, and the consumer is idempotent so a later
    // replay is safe.
    console.error(`[gateway] publish to ${topic} failed`, err);
    return null;
  }
}
