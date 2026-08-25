import { useEffect, useMemo, useState, type ReactNode } from "react";

import { createDevAuth } from "@/auth/dev-auth";
import { createFirebaseAuth } from "@/auth/firebase-auth";
import { firebaseConfigured } from "@/auth/firebase";
import { AuthContext } from "@/auth/context";
import type { AuthAdapter, AuthUser } from "@/auth/types";

/**
 * Chooses the adapter. Today there is only the local one; when Firebase config
 * is present this is where `createFirebaseAuth()` gets picked instead, and
 * nothing else in the app changes.
 */
function createAuth(): AuthAdapter {
  // Firebase whenever a project or emulator is configured. The local adapter
  // remains only so the UI is clickable with nothing running at all.
  return firebaseConfigured ? createFirebaseAuth() : createDevAuth();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAuth(), []);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stop = adapter.init((next) => {
      setUser(next);
      setLoading(false);
    });
    return stop;
  }, [adapter]);

  const value = useMemo(
    () => ({ user, loading, adapter }),
    [user, loading, adapter],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
