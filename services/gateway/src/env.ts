/**
 * Configuration, validated once at boot.
 *
 * Nothing here has a production-safe default that could be wrong silently:
 * a missing project id fails fast rather than surfacing as a confusing
 * Firestore permission error twenty minutes later.
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const production = process.env.NODE_ENV === "production";

export const env = {
  port: Number(process.env.PORT ?? 8080),
  projectId: usingEmulator
    ? (process.env.GOOGLE_CLOUD_PROJECT ?? "alltheway-local")
    : required("GOOGLE_CLOUD_PROJECT"),

  /**
   * Vertex endpoint for model calls. Deliberately `global`, which is where the
   * current Gemini Flash models are reachable.
   *
   * This is INDEPENDENT of where the service runs: Cloud Run stays in
   * europe-west1 (which is what firebase.json's /api/** rewrite must match).
   * Note that `global` carries no EU data residency — if that ever becomes a
   * requirement, this must move and the model pins back to a DRZ-supported one.
   */
  vertexLocation: process.env.GOOGLE_CLOUD_LOCATION ?? "global",

  /** Pinned, never "latest": a silent model swap changes agent behaviour. */
  model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",

  /** The Live API model for voice. Pinned for the same reason. */
  liveModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-preview",

  usingEmulator,
  production,

  /**
   * Lets the gateway serve a fixed dev identity while the web client is still
   * on the local auth adapter. Refuses to engage in production, so it cannot
   * be turned on by a stray env var in a deployed service.
   */
  allowAnonymous: !production && process.env.ALLOW_ANONYMOUS === "true",

  devUserId: process.env.DEV_USER_ID ?? "dev-user",

  /** Internal-only service; never reachable from the internet. */
  orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:8090",

  /**
   * Origins allowed to open a stream cross-origin.
   *
   * Needed because the SSE endpoint cannot be served through a Firebase Hosting
   * rewrite: Hosting imposes a documented, unconfigurable 60-second request
   * timeout on rewrites, which severs a long-lived stream regardless of any
   * buffering behaviour. So the stream is served from the gateway's own
   * hostname while the rest of the app stays behind Hosting -- and that split
   * is what makes this cross-origin.
   *
   * Empty in development, where Vite proxies /api and the request is same-origin.
   */
  webOrigins: (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
