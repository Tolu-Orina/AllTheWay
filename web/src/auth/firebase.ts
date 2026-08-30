import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Auth,
} from "firebase/auth";

/**
 * Firebase client.
 *
 * Against the Auth emulator the apiKey is not checked, so a placeholder is
 * correct rather than lazy — there is no secret to leak here. Real deployments
 * supply the project's public web config through VITE_ vars at build time.
 */
/** The custom domain the product is served from in production. */
const PRIMARY_HOST = "alltheway.rinegansolutions.com";

/**
 * The domain Firebase sends people to for Google sign-in.
 *
 * Built as `alltheway-rinegan.firebaseapp.com` while the app is served from
 * `alltheway.rinegansolutions.com`, which makes the whole OAuth handshake
 * cross-origin. That arrangement depends on third-party cookies, and Chrome and
 * Safari now block them by default: the popup opens, Google authenticates, and
 * the result never gets back to the page that asked. Nothing throws on our
 * side, which is why it reads as "Google sign-in did not finish".
 *
 * Firebase Hosting serves `/__/auth/*` on *every* domain attached to the
 * project — verified against all three of ours — so pointing this at whatever
 * host the page is already on makes the handshake same-origin and removes the
 * dependency on third-party cookies entirely.
 *
 * The configured value is still the fallback, and is what a local dev server or
 * an unrecognised origin uses.
 */
function authDomainForThisOrigin(): string {
  const configured = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "localhost";
  if (typeof window === "undefined") return configured;

  const host = window.location.hostname;
  // Only domains this project actually serves the handler from. An arbitrary
  // host must never be trusted here: it is where credentials are returned.
  const servesHandler =
    host.endsWith(".web.app") || host.endsWith(".firebaseapp.com") || host === PRIMARY_HOST;

  return servesHandler ? host : configured;
}


const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: authDomainForThisOrigin(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "alltheway-local",
};

export const firebaseApp = initializeApp(options);

/**
 * Persistence and when the popup iframe is loaded are the two knobs that
 * decide whether sign-in feels instant or broken, especially on a phone.
 *
 * `getAuth()` defaults to IndexedDB persistence and eagerly loads `iframe.js`
 * for popup/redirect. IndexedDB has a documented hang on Mobile Safari and
 * some Chrome Android profiles: `onAuthStateChanged` never fires, the UI
 * stays on "Checking session", and every API call waits on `authStateReady()`.
 * That is the slow login. `browserLocalPersistence` restores from localStorage
 * in one synchronous read.
 *
 * The popup redirect resolver is *not* passed here. Passing it makes Auth
 * download `iframe.js` (~260KB) on every page, including the first paint of
 * `/app/login`. It is passed only to `signInWithPopup`, `signInWithRedirect`,
 * and `getRedirectResult` — on click, and when Google returns to an auth
 * screen. Landing never loads that iframe.
 */
function createAuth(): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
    });
  } catch {
    // HMR re-executes this module; Auth can only be initialized once per app.
    return getAuth(firebaseApp);
  }
}

export const firebaseAuth = createAuth();

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(firebaseAuth, `http://${emulatorHost}`, { disableWarnings: true });
}

/** True when a real project is configured; the app falls back to local auth otherwise. */
export const firebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || emulatorHost,
);
