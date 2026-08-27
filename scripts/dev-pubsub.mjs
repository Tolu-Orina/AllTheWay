/**
 * Creates the topics and push subscriptions on the Pub/Sub emulator.
 *
 * The emulator keeps no state across restarts, so this is idempotent and safe
 * to re-run. In a real project Terraform owns these — see infra/modules/stack.
 *
 * Push, not pull, on purpose: that is how Eventarc delivers to Cloud Run, so
 * the services have the same shape locally as in production.
 */
const HOST = process.env.PUBSUB_EMULATOR_HOST ?? "127.0.0.1:8085";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "alltheway-local";
const BASE = `http://${HOST}/v1/projects/${PROJECT}`;

const WIRING = [
  { topic: "session-ended", sub: "profile-synth", endpoint: "http://localhost:8092/events" },
  { topic: "session-ended", sub: "watcher-on-session-ended", endpoint: "http://localhost:8091/events/session-ended" },
  { topic: "watcher-trigger", sub: "watcher-run", endpoint: "http://localhost:8091/events" },
  { topic: "watcher-due", sub: "watcher-due-scan", endpoint: "http://localhost:8091/events/due" },
];

const put = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 409 means it already exists, which is success for our purposes.
  return res.status === 200 ? "created" : res.status === 409 ? "exists" : `HTTP ${res.status}`;
};

for (const { topic, sub, endpoint } of WIRING) {
  console.log(`  topic ${topic}: ${await put(`/topics/${topic}`)}`);
  console.log(
    `  sub ${sub} -> ${endpoint}: ${await put(`/subscriptions/${sub}`, {
      topic: `projects/${PROJECT}/topics/${topic}`,
      pushConfig: { pushEndpoint: endpoint },
    })}`,
  );
}
