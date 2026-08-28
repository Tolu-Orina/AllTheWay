import { ApiErrorSchema } from "@alltheway/contracts";
import type { z } from "zod";

import { firebaseAuth } from "@/auth/firebase";

/**
 * The one place the client talks to the gateway.
 *
 * Every request carries a fresh Firebase ID token, and every response is parsed
 * through the shared contract before it reaches a screen — so a server-side
 * rename fails loudly here rather than as an undefined three components deep.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * On a cold page load Firebase restores the session asynchronously, so
 * `currentUser` is null for the first moments. Reading it synchronously sends
 * the opening requests with no token and they come back 401 — which only ever
 * reproduces on a hard reload, never on in-app navigation.
 *
 * `authStateReady()` can hang when IndexedDB persistence is wedged (the
 * mobile Safari failure). Race it against a bound so a request either goes
 * authenticated or goes without a token, rather than never going at all.
 * If `currentUser` is already set — the common case after sign-in — skip the
 * wait entirely so Home's first paint is not queued behind a token refresh.
 */
let authReady: Promise<unknown> | null = null;
function whenAuthReady() {
  authReady ??= Promise.race([
    firebaseAuth.authStateReady(),
    new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
  ]);
  return authReady;
}

export async function authHeader(): Promise<Record<string, string>> {
  if (!firebaseAuth.currentUser) await whenAuthReady();
  const user = firebaseAuth.currentUser;
  if (!user) return {};
  // false: use the cached token. Forcing a refresh here is what made every
  // screen's first API call wait on identitytoolkit after login.
  const token = await user.getIdToken(false);
  return { authorization: `Bearer ${token}` };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(await authHeader()),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let code = "internal";
    let message = "Something went wrong. Try again.";
    try {
      const parsed = ApiErrorSchema.safeParse(await res.json());
      if (parsed.success) {
        code = parsed.data.code;
        message = parsed.data.message;
      }
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError(code, message, res.status);
  }

  return res;
}

/**
 * Raw bytes, authenticated.
 *
 * An `<img src>` or `<iframe src>` cannot carry an Authorization header, so
 * pointing one at an authenticated endpoint produces a 401 the browser
 * reports as a broken image. Anything binary is fetched here and turned into
 * a blob URL by the caller — which also means the caller owns revoking it.
 */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await request(path);
  return res.blob();
}

/** The same, as text. For a document whose content is edited in place. */
export async function apiText(path: string): Promise<string> {
  const res = await request(path);
  return res.text();
}

export async function apiDelete(path: string): Promise<void> {
  await request(path, { method: "DELETE" });
}

export async function apiGet<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
  const res = await request(path);
  return schema.parse(await res.json());
}

export async function apiPost<S extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema?: S,
): Promise<S extends z.ZodTypeAny ? z.infer<S> : void> {
  const res = await request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  if (!schema) return undefined as never;
  return schema.parse(await res.json());
}
