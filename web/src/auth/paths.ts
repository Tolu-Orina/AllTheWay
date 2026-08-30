/**
 * Product URLs.
 *
 * The installed PWA is scoped to `/app/`. Auth that lived at `/login` opened
 * in the browser instead of the app. These paths keep sign-in, sign-up, and
 * the codes inside that window. The old URLs still redirect here.
 */

export const APP_HOME = "/app";
export const LOGIN = "/app/login";
export const SIGNUP = "/app/signup";
export const VERIFY = "/app/verify";
export const FORGOT_PASSWORD = "/app/forgot-password";
export const RESET_PASSWORD = "/app/reset-password";

export const LEGACY_AUTH_REDIRECTS: ReadonlyArray<readonly [string, string]> = [
  ["/login", LOGIN],
  ["/signup", SIGNUP],
  ["/verify", VERIFY],
  ["/forgot-password", FORGOT_PASSWORD],
  ["/reset-password", RESET_PASSWORD],
];

const AUTH_PAGES = new Set([
  "login",
  "signup",
  "verify",
  "forgot-password",
  "reset-password",
]);

function pathnameOf(path: string): string {
  const noQuery = path.split("?")[0] ?? path;
  if (noQuery.length > 1 && noQuery.endsWith("/")) return noQuery.slice(0, -1);
  return noQuery || "/";
}

export function isAuthPath(path: string): boolean {
  const pathname = pathnameOf(path);
  const leaf = pathname.startsWith("/app/")
    ? pathname.slice("/app/".length)
    : pathname.replace(/^\//, "");
  return AUTH_PAGES.has(leaf);
}

/**
 * Where to send someone after they actually sign in.
 *
 * Auth screens, the marketing site, and anything outside `/app` would either
 * loop or eject the installed app. Those collapse to Home.
 */
export function afterAuthPath(
  path: string | undefined | null,
  fallback = APP_HOME,
): string {
  if (!path) return fallback;
  const pathname = pathnameOf(path);
  if (!pathname.startsWith(APP_HOME)) return fallback;
  if (isAuthPath(pathname)) return fallback;
  return pathname === APP_HOME || pathname === `${APP_HOME}/`
    ? APP_HOME
    : pathname;
}
