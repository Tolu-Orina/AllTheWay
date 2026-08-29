import type { AuthAdapter, AuthUser } from "@/auth/types";

/**
 * Local auth for development.
 *
 * Everything lives in localStorage and no network is involved, so the entire
 * flow — sign up, code, sign in, reset — is clickable before a Firebase project
 * exists. The issued code is logged to the console, since there is no mailer.
 *
 * This is never used in production: `createAuth()` picks the Firebase adapter
 * as soon as one is configured.
 */

const USERS_KEY = "attw.dev.users";
const SESSION_KEY = "attw.dev.session";
const CODES_KEY = "attw.dev.codes";

type StoredUser = AuthUser & { password: string };

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — the session simply will not persist */
  }
};

const users = () => read<Record<string, StoredUser>>(USERS_KEY, {});
const codes = () =>
  read<Record<string, { code: string; sentAt: number }>>(CODES_KEY, {});
const norm = (email: string) => email.trim().toLowerCase();
const publicUser = ({ password: _password, ...rest }: StoredUser): AuthUser =>
  rest;

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

export function createDevAuth(): AuthAdapter {
  let listener: ((u: AuthUser | null) => void) | null = null;

  const emit = () => {
    const email = read<string | null>(SESSION_KEY, null);
    const u = email ? users()[email] : undefined;
    listener?.(u ? publicUser(u) : null);
  };

  return {
    init(onChange) {
      listener = onChange;
      // Async so consumers always see one loading tick, exactly as Firebase behaves.
      queueMicrotask(emit);
      return () => {
        listener = null;
      };
    },

    async signIn(email, password) {
      await delay();
      const u = users()[norm(email)];
      // Deliberately generic: saying which half was wrong tells an attacker
      // whether the address exists.
      if (!u || u.password !== password) {
        return { ok: false, message: "Incorrect email or password." };
      }
      write(SESSION_KEY, norm(email));
      emit();
      return { ok: true };
    },

    async signUp(email, password) {
      await delay();
      const all = users();
      if (all[norm(email)]) {
        return {
          ok: false,
          message: "That email already has an account. Try signing in.",
        };
      }
      all[norm(email)] = {
        uid: crypto.randomUUID(),
        email: norm(email),
        emailVerified: false,
        password,
      };
      write(USERS_KEY, all);
      write(SESSION_KEY, norm(email));
      emit();
      return { ok: true };
    },

    async signInWithGoogle() {
      await delay(500);
      const email = "jordan.avery@gmail.com";
      const all = users();
      all[email] ??= {
        uid: crypto.randomUUID(),
        email,
        emailVerified: true,
        displayName: "Jordan Avery",
        password: "",
      };
      write(USERS_KEY, all);
      write(SESSION_KEY, email);
      emit();
      return { ok: true };
    },

    async signOut() {
      write(SESSION_KEY, null);
      emit();
    },

    async sendVerificationCode(email) {
      await delay();
      const all = codes();
      const previous = all[norm(email)];
      if (previous && Date.now() - previous.sentAt < 30_000) {
        return {
          ok: false,
          message: "A code was just sent. Check your inbox, or wait a moment.",
        };
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      all[norm(email)] = { code, sentAt: Date.now() };
      write(CODES_KEY, all);
      // No mailer in development — the code goes to the console instead.
      console.info(`[dev-auth] verification code for ${norm(email)}: ${code}`);
      return { ok: true };
    },

    async verifyCode(email, code) {
      await delay();
      const entry = codes()[norm(email)];
      if (!entry || entry.code !== code.trim()) {
        return {
          ok: false,
          message: "That code is not right. Check it and try again.",
        };
      }
      if (Date.now() - entry.sentAt > 10 * 60_000) {
        return { ok: false, message: "That code has expired. Send a new one." };
      }
      const all = users();
      const u = all[norm(email)];
      if (u) {
        u.emailVerified = true;
        write(USERS_KEY, all);
      }
      emit();
      return { ok: true };
    },

    async requestPasswordReset(email) {
      await delay();
      // Always reports success: whether an address is registered is not
      // something an unauthenticated caller gets to learn.
      const all = users();
      if (all[norm(email)]) {
        const c = codes();
        const code = String(Math.floor(100000 + Math.random() * 900000));
        c[norm(email)] = { code, sentAt: Date.now() };
        write(CODES_KEY, c);
        console.info(
          `[dev-auth] password reset code for ${norm(email)}: ${code}`,
        );
      }
      return { ok: true };
    },

    async resetPassword(email, code, password) {
      await delay();
      const entry = codes()[norm(email)];
      if (!entry || entry.code !== code.trim()) {
        return {
          ok: false,
          message: "That code is not right. Check it and try again.",
        };
      }
      const all = users();
      const u = all[norm(email)];
      if (!u)
        return {
          ok: false,
          message: "That code is not right. Check it and try again.",
        };
      u.password = password;
      write(USERS_KEY, all);
      return { ok: true };
    },

    async updateDisplayName(name) {
      await delay();
      const email = read<string | null>(SESSION_KEY, null);
      if (!email) return { ok: false, message: "You are not signed in." };
      const all = users();
      const u = all[email];
      if (!u) return { ok: false, message: "You are not signed in." };
      const trimmed = name.trim();
      if (trimmed) u.displayName = trimmed;
      else delete u.displayName;
      write(USERS_KEY, all);
      emit();
      return { ok: true };
    },
  };
}
