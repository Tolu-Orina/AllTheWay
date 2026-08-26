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
  model: process.env.GEMINI_MODEL ?? "gemini-3.7-flash",

  /**
   * Where the Live API session is opened. Deliberately NOT `vertexLocation`.
   *
   * `global` has no Live model. Verified against this project: the setup
   * message is answered with `1008 Publisher model .../locations/global/...
   * was not found`, while europe-west1, europe-west4 and us-central1 all
   * return setupComplete. Voice therefore failed on every attempt in
   * production, while the unit tests — which only check that the URL for
   * `global` is not location-prefixed — passed.
   *
   * europe-west1 matches where Cloud Run runs, so voice audio stays in the EU
   * even though text generation on `global` does not.
   */
  liveLocation: process.env.GOOGLE_CLOUD_LIVE_LOCATION ?? "europe-west1",

  /** Native audio Live API model. Pinned: auto language detect, no language_code. */
  liveModel: process.env.GEMINI_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio",

  usingEmulator,
  production,

  /**
   * Lets the gateway serve a fixed dev identity while the web client is still
   * on the local auth adapter. Refuses to engage in production, so it cannot
   * be turned on by a stray env var in a deployed service.
   */
  allowAnonymous: !production && process.env.ALLOW_ANONYMOUS === "true",

  devUserId: process.env.DEV_USER_ID ?? "dev-user",

  /**
   * The Agent Registry. Internal-only, proxied for the browser.
   *
   * Empty disables the endpoint rather than producing a confusing upstream
   * error — a registry that is not deployed is a supported state.
   */
  registryUrl: (process.env.REGISTRY_URL ?? "").replace(/\/$/, ""),

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
  /**
   * Mail. Both must be present for production to send anything; either one
   * missing leaves the mailer unconfigured, which throws on send rather than
   * falling back to logging a credential to stdout.
   *
   * The key is mounted from Secret Manager by Cloud Run, so it exists in the
   * process and nowhere else — not in the revision spec, not in Terraform.
   */
  /**
   * The OAuth client used to connect a user's Google account.
   *
   * Mounted from Secret Manager by Cloud Run, like the mail key. Empty means
   * connecting an account is unavailable — reported as such, rather than
   * producing a consent URL that fails at Google with an opaque error.
   */
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",

  /**
   * Signs the scope token that tells the librarian which user a request is
   * for. Mounted from Secret Manager, and deliberately a different keypair
   * from AgentCard signing — the gateway is excluded from minting cards, and
   * a service that can mint scope tokens should not gain that.
   */
  scopeTokenSigningKey: process.env.SCOPE_TOKEN_SIGNING_KEY ?? "",

  /** The librarian. Internal-only; the browser reaches it through here. */
  librarianUrl: (process.env.LIBRARIAN_URL ?? "").replace(/\/$/, ""),
  // Meetings. Empty disables the feature rather than failing at boot: a
  // deployment without a scribe should serve everything else, and a meetings
  // list that 503s is a better answer than a gateway that will not start.
  scribeUrl: (process.env.SCRIBE_URL ?? "").replace(/\/$/, ""),

  resendApiKey: process.env.RESEND_API_KEY ?? "",
  mailFrom: process.env.MAIL_FROM ?? "",

  webOrigins: (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
