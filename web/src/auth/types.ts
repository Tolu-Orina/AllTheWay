export type AuthUser = {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  emailVerified: boolean;
};

export type AuthResult = { ok: true } | { ok: false; message: string };

/**
 * The seam between the app and whatever actually authenticates.
 *
 * `dev-auth` implements this locally so the whole flow is clickable before any
 * Firebase project exists. Swapping in Firebase means writing one more file
 * that satisfies this interface — no screen changes.
 */
export interface AuthAdapter {
  /** Resolves once the adapter knows whether someone is signed in. */
  init(onChange: (user: AuthUser | null) => void): () => void;

  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  signInWithGoogle(): Promise<AuthResult>;
  signOut(): Promise<void>;

  /** Emails a 6-digit code. Safe to call repeatedly; the adapter rate-limits. */
  sendVerificationCode(email: string): Promise<AuthResult>;
  verifyCode(email: string, code: string): Promise<AuthResult>;

  requestPasswordReset(email: string): Promise<AuthResult>;
  resetPassword(
    email: string,
    code: string,
    password: string,
  ): Promise<AuthResult>;

  /** Persist a chosen name. Empty clears it so greetings fall back to the email. */
  updateDisplayName(name: string): Promise<AuthResult>;
}

/** Shared password policy, shown to the user before they submit rather than after. */
export const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One number", test: (p: string) => /\d/.test(p) },
  { label: "One letter", test: (p: string) => /[a-zA-Z]/.test(p) },
];

export function passwordProblems(password: string) {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
