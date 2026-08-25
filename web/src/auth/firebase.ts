import { initializeApp, type FirebaseOptions } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

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
export const firebaseAuth = getAuth(firebaseApp);

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(firebaseAuth, `http://${emulatorHost}`, { disableWarnings: true });
}

/** True when a real project is configured; the app falls back to local auth otherwise. */
export const firebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_PROJECT_ID || emulatorHost,
);
