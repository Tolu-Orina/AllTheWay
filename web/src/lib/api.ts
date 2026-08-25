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
 */
let authReady: Promise<unknown> | null = null;
function whenAuthReady() {
  authReady ??= firebaseAuth.authStateReady();
  return authReady;
}

export async function authHeader(): Promise<Record<string, string>> {
  await whenAuthReady();
  const user = firebaseAuth.currentUser;
  if (!user) return {};
  // getIdToken refreshes automatically when the token is close to expiry.
  const token = await user.getIdToken();
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
