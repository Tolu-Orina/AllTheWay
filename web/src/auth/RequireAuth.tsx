import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "@/auth/useAuth";

/**
 * True when running locally, so every page stays reachable during development
 * without signing in.
 *
 * Two independent conditions, both of which are structurally impossible in
 * production: `DEV` is false in any built bundle, and the deployed origin is
 * alltheway.rinegansolutions.com — a visitor cannot make their browser believe
 * that origin is localhost. There is no env flag here on purpose; a flag is
 * something you can accidentally ship.
 */
function isLocal() {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (isLocal()) return <Outlet />;

  // Never redirect while the adapter is still resolving, or a signed-in user
  // gets bounced to /login on every refresh.
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <p className="text-[14px] text-muted-foreground" role="status">
          Checking your session…
        </p>
      </div>
    );
  }

  if (!user) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
