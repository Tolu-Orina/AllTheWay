import { useEffect, useMemo, useState, type ReactNode } from "react";

import { createDevAuth } from "@/auth/dev-auth";
import { createFirebaseAuth, peekPersistedUser } from "@/auth/firebase-auth";
import { firebaseConfigured } from "@/auth/firebase";
import { AuthContext } from "@/auth/context";
import type { AuthAdapter, AuthUser } from "@/auth/types";
import { serveExtensionToken } from "@/app/extension-bridge";
import { reportDeviceClock } from "@/app/clock";

/**
 * Chooses the adapter.
 *
 * ## The production fallback is fatal, not silent
 *
 * This used to fall back to the local adapter whenever Firebase config was
 * absent — including in a production build, where the config simply had not
 * been passed to the bundler. The deployed site then ran `createDevAuth()`,
 * which prints verification codes to the browser console, signs a user in
 * locally, and issues no ID token. It looked like it had authentication: /app
 * opened, sign-in "worked", and every API call quietly 401'd.
 *
 * A missing-config fallback that degrades to no-real-auth is worse than a blank
 * screen, because nothing announces it. So in production the absence of config
 * is now a hard failure, and the local adapter is reachable only in a
 * development build.
 */
function createAuth(): AuthAdapter {
  if (firebaseConfigured) return createFirebaseAuth();

  if (import.meta.env.PROD) {
    throw new Error(
      "Firebase is not configured in this build. Refusing to fall back to the " +
        "development auth adapter, which authenticates nobody. Set " +
        "VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN and " +
        "VITE_FIREBASE_PROJECT_ID at build time.",
    );
  }

  // Development only: keeps the UI clickable with nothing running at all.
  return createDevAuth();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAuth(), []);
  const restored = firebaseConfigured ? peekPersistedUser() : null;
  const [user, setUser] = useState<AuthUser | null>(restored);
  const [loading, setLoading] = useState(!restored);

  useEffect(() => {
    const stop = adapter.init((next) => {
      setUser(next);
      setLoading(false);
    });
    // IndexedDB hangs used to leave this true forever. Persistence is now
    // localStorage, but a fail-safe still beats a blank "Checking session"
    // screen if Auth never calls back — five seconds is longer than a
    // localStorage read and shorter than anyone will wait.
    const failSafe = window.setTimeout(() => setLoading(false), 5_000);
    return () => {
      stop();
      window.clearTimeout(failSafe);
    };
  }, [adapter]);

  useEffect(() => {
    // Lives here, not in AppLayout: the content script asks as soon as the
    // AllTheWay origin loads, including `/login`. A listener that only
    // existed inside `/app` lost the first ask and never announced sign-in.
    if (!firebaseConfigured) return;
    return serveExtensionToken();
  }, []);

  useEffect(() => {
    if (!user) return;
    reportDeviceClock();
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, adapter }),
    [user, loading, adapter],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
