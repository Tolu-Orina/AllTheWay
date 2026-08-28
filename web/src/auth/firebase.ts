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
const options: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "localhost",
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
 * `/login`. It is passed only to `signInWithPopup` / `signInWithRedirect`.
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
