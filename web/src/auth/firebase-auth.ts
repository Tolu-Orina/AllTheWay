import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  getRedirectResult,
  onAuthStateChanged,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  updateProfile,
} from "firebase/auth";

import { firebaseAuth } from "@/auth/firebase";
import { ApiError, apiPost } from "@/lib/api";
import type { AuthAdapter, AuthResult, AuthUser } from "@/auth/types";
import {
  clearGoogleRedirectPending,
  googleRedirectPending,
  markGoogleRedirectPending,
  prefersGoogleRedirect,
} from "@/auth/google-redirect";
import { isAuthPath } from "@/auth/paths";

export {
  rememberAfterAuth,
  takeAfterAuth,
  prefersGoogleRedirect,
} from "@/auth/google-redirect";

/**
 * Firebase Auth for identity, the gateway for the six-digit codes.
 *
 * Firebase has no native email-code flow — its verification and passwordless
 * sign-in are both links — so codes are issued and checked server-side. Firebase
 * owns who you are; the gateway owns whether your address is proven.
 */

/**
 * Firebase error codes are specific enough to enumerate accounts
 * (`user-not-found` vs `wrong-password`), so sign-in collapses them into one
 * message. Only genuinely actionable states get their own wording.
 */
function toMessage(err: unknown, fallback = "Incorrect email or password."): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Try signing in.";
    case "auth/weak-password":
      return "Choose a longer password — at least 8 characters.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/redirect-cancelled-by-user":
      return "That sign-in window closed before it finished. Try again.";
    case "auth/popup-blocked":
      return "The sign-in window was blocked. Allow popups for this site, or try again.";
    case "auth/argument-error":
    case "auth/operation-not-supported-in-this-environment":
      return "Google sign-in is not available in this browser. Try email.";
    case "auth/unauthorized-domain":
      return "This site is not authorised for Google sign-in. That is on us, not you.";
    case "auth/network-request-failed":
      return "We could not reach the network. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return code.startsWith("auth/") ? `${fallback} (${code})` : fallback;
  }
}

const toUser = (u: NonNullable<typeof firebaseAuth.currentUser>): AuthUser => ({
  uid: u.uid,
  email: u.email ?? "",
  displayName: u.displayName ?? undefined,
  photoURL: u.photoURL ?? undefined,
  emailVerified: u.emailVerified,
});

export function currentAuthUser(): AuthUser | null {
  const u = firebaseAuth.currentUser;
  return u ? toUser(u) : null;
}

/**
 * Restore a session for the first paint without waiting on Firebase's
 * listener. `currentUser` is often still null until `authStateReady()`.
 * Persistence writes `firebase:authUser:{apiKey}:[DEFAULT]` to localStorage;
 * reading it here is how signed-in landing CTAs are correct immediately.
 */
export function peekPersistedUser(): AuthUser | null {
  const live = currentAuthUser();
  if (live) return live;
  try {
    const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
    if (!apiKey) return null;
    const raw = localStorage.getItem(`firebase:authUser:${apiKey}:[DEFAULT]`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      uid?: string;
      email?: string;
      displayName?: string;
      photoURL?: string;
      emailVerified?: boolean;
    };
    if (!parsed.uid) return null;
    return {
      uid: parsed.uid,
      email: parsed.email ?? "",
      displayName: parsed.displayName ?? undefined,
      photoURL: parsed.photoURL ?? undefined,
      emailVerified: Boolean(parsed.emailVerified),
    };
  } catch {
    return null;
  }
}

function settleGoogleRedirect(): void {
  // iframe.js loads when the resolver is used. Landing must not pay that.
  // Auth screens must: Firebase returns here after Google, and without the
  // same resolver the session never completes.
  if (typeof window === "undefined") return;
  if (!googleRedirectPending() && !isAuthPath(window.location.pathname)) return;
  void getRedirectResult(firebaseAuth, browserPopupRedirectResolver)
    .catch(() => {
      /* reported the next time they tap Google, not as a spinner on `/` */
    })
    .finally(() => clearGoogleRedirectPending());
}

const fromApi = (err: unknown): AuthResult =>
  err instanceof ApiError
    ? { ok: false, message: err.message }
    : { ok: false, message: "Something went wrong. Try again." };

const POPUP_FALLBACK = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
]);

async function redirectToGoogle(provider: GoogleAuthProvider): Promise<AuthResult> {
  markGoogleRedirectPending();
  const outcome = await Promise.race([
    // Same resolver as popup. initializeAuth does not include it, so every
    // redirect/popup call must pass it or Firebase throws auth/argument-error
    // — the "Google sign-in did not finish" report, before the page ever leaves.
    signInWithRedirect(firebaseAuth, provider, browserPopupRedirectResolver).then(
      () => "started" as const,
    ),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 20_000)),
  ]);
  if (outcome === "timeout") {
    return {
      ok: false,
      message: "Google sign-in is taking too long. Try email, or tap Google again.",
    };
  }
  return { ok: true, redirected: true };
}

async function signInWithGoogle(): Promise<AuthResult> {
  const googleFail = "Google sign-in did not finish. Try again, or use email.";
  const provider = new GoogleAuthProvider();
  try {
    if (prefersGoogleRedirect()) return await redirectToGoogle(provider);
    // Chrome logs Cross-Origin-Opener-Policy on popup.closed. That is
    // Google's OAuth window, not a missing Cloud Console setting. Hosting
    // sends COOP: same-origin-allow-popups; do not switch to same-origin.
    await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver);
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    console.warn("[auth] Google sign-in failed", code || err);
    if (POPUP_FALLBACK.has(code) && !prefersGoogleRedirect()) {
      try {
        return await redirectToGoogle(provider);
      } catch (redirectErr) {
        return { ok: false, message: toMessage(redirectErr, googleFail) };
      }
    }
    return { ok: false, message: toMessage(err, googleFail) };
  }
}

export function createFirebaseAuth(): AuthAdapter {
  return {
    init(onChange) {
      // onAuthStateChanged unblocks the UI as soon as the persisted user is
      // known. onIdTokenChanged used to be the only listener, and it waits
      // for a token fetch — on a slow mobile radio that is the entire "signed
      // in, still staring at Checking session" report.
      //
      // onIdTokenChanged is still subscribed: reload() after email verification
      // does not fire onAuthStateChanged, and the Verify screen needs
      // emailVerified to flip without a full reload.
      const unsubAuth = onAuthStateChanged(firebaseAuth, (u) =>
        onChange(u ? toUser(u) : null),
      );
      const unsubToken = onIdTokenChanged(firebaseAuth, (u) =>
        onChange(u ? toUser(u) : null),
      );

      void settleGoogleRedirect();

      return () => {
        unsubAuth();
        unsubToken();
      };
    },

    async signIn(email, password) {
      try {
        await signInWithEmailAndPassword(firebaseAuth, email, password);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: toMessage(err) };
      }
    },

    async signUp(email, password) {
      try {
        await createUserWithEmailAndPassword(firebaseAuth, email, password);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: toMessage(err) };
      }
    },

    signInWithGoogle,

    async signOut() {
      await fbSignOut(firebaseAuth);
    },

    async sendVerificationCode() {
      // The address comes from the ID token server-side, never from the client,
      // so nobody can ask us to send a code to an address they do not own.
      try {
        await apiPost("/auth/send-code", {});
        return { ok: true };
      } catch (err) {
        return fromApi(err);
      }
    },

    async verifyCode(_email, code) {
      try {
        await apiPost("/auth/verify-code", { code });
        // Pull a fresh token so emailVerified is current on the client too.
        await firebaseAuth.currentUser?.getIdToken(true);
        await firebaseAuth.currentUser?.reload();
        return { ok: true };
      } catch (err) {
        return fromApi(err);
      }
    },

    async requestPasswordReset(email) {
      try {
        await apiPost("/auth/reset-request", { email });
      } catch {
        // The endpoint answers identically for unknown addresses; a transport
        // failure must not reveal anything either.
      }
      return { ok: true };
    },

    async resetPassword(email, code, password) {
      try {
        await apiPost("/auth/reset-confirm", { email, code, password });
        return { ok: true };
      } catch (err) {
        return fromApi(err);
      }
    },

    async updateDisplayName(name) {
      const current = firebaseAuth.currentUser;
      if (!current) return { ok: false, message: "You are not signed in." };
      try {
        const trimmed = name.trim();
        await updateProfile(current, { displayName: trimmed || null });
        await current.reload();
        await current.getIdToken(true);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: toMessage(err) };
      }
    },
  };
}
