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

/**
 * Firebase Auth for identity, the gateway for the six-digit codes.
 *
 * Firebase has no native email-code flow — its verification and passwordless
 * sign-in are both links — so codes are issued and checked server-side. Firebase
 * owns who you are; the gateway owns whether your address is proven.
 */

/**
 * Where to send the person after a Google redirect comes back.
 *
 * Popup sign-in returns in-page. Redirect unloads the page, so the destination
 * has to survive in sessionStorage rather than in React state.
 */
const AFTER_AUTH_KEY = "alltheway:after-auth";

export function rememberAfterAuth(path: string): void {
  try {
    sessionStorage.setItem(AFTER_AUTH_KEY, path);
  } catch {
    /* private windows throw; they will land on /app */
  }
}

export function takeAfterAuth(fallback = "/app"): string {
  try {
    const stored = sessionStorage.getItem(AFTER_AUTH_KEY);
    if (stored) sessionStorage.removeItem(AFTER_AUTH_KEY);
    return stored || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Popup Google sign-in is the right desktop path. On a phone it is the wrong
 * one: iOS Safari and installed PWAs block or stall the popup, and even when
 * it opens, the iframe round-trip is the "Firebase is slow" report.
 *
 * Redirect is what Google's own mobile guidance uses. Coarse pointer, iOS,
 * or an installed PWA — any one is enough.
 */
export function prefersGoogleRedirect(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const iOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return Boolean(coarse || standalone || iOS);
}

/**
 * Firebase error codes are specific enough to enumerate accounts
 * (`user-not-found` vs `wrong-password`), so sign-in collapses them into one
 * message. Only genuinely actionable states get their own wording.
 */
function toMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Try signing in.";
    case "auth/weak-password":
      return "Choose a longer password — at least 8 characters.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "That sign-in window closed before it finished. Try again.";
    case "auth/popup-blocked":
      return "The sign-in window was blocked. Allow popups for this site, or try again.";
    case "auth/operation-not-supported-in-this-environment":
      return "Google sign-in is not available in this browser. Try the installed app, or use email.";
    case "auth/unauthorized-domain":
      return "This site is not authorised for Google sign-in. That is on us, not you.";
    case "auth/network-request-failed":
      return "We could not reach the network. Check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";
    default:
      return "Incorrect email or password.";
  }
}

const toUser = (u: NonNullable<typeof firebaseAuth.currentUser>): AuthUser => ({
  uid: u.uid,
  email: u.email ?? "",
  displayName: u.displayName ?? undefined,
  photoURL: u.photoURL ?? undefined,
  emailVerified: u.emailVerified,
});

const fromApi = (err: unknown): AuthResult =>
  err instanceof ApiError
    ? { ok: false, message: err.message }
    : { ok: false, message: "Something went wrong. Try again." };

const POPUP_FALLBACK = new Set([
  "auth/popup-blocked",
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/operation-not-supported-in-this-environment",
]);

async function signInWithGoogle(): Promise<AuthResult> {
  const provider = new GoogleAuthProvider();
  try {
    if (prefersGoogleRedirect()) {
      await signInWithRedirect(firebaseAuth, provider, browserPopupRedirectResolver);
      // The page is unloading. The adapter never returns; Login/Signup pick
      // the user up from onAuthStateChanged when they remount.
      return { ok: true };
    }
    await signInWithPopup(firebaseAuth, provider, browserPopupRedirectResolver);
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    // A phone that we failed to classify as redirect still gets a second
    // chance rather than a stuck popup error.
    if (POPUP_FALLBACK.has(code) && !prefersGoogleRedirect()) {
      try {
        await signInWithRedirect(firebaseAuth, provider, browserPopupRedirectResolver);
        return { ok: true };
      } catch (redirectErr) {
        return { ok: false, message: toMessage(redirectErr) };
      }
    }
    return { ok: false, message: toMessage(err) };
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

      void getRedirectResult(firebaseAuth, browserPopupRedirectResolver).catch(() => {
        // A failed redirect is reported the next time they tap Google, not as
        // a stuck spinner on a page they just landed on.
      });

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
