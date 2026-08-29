import { useAuth } from "@/auth/useAuth";

export type User = {
  email: string;
  displayName?: string;
  photoURL?: string;
};

/**
 * Only ever reached on localhost, where RequireAuth is bypassed so every page
 * stays browsable without signing in.
 */
const DEMO_USER: User = { email: "jordan.avery@example.com" };

export function useAppUser(): User {
  const { user } = useAuth();
  if (!user) return DEMO_USER;
  return {
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

const capitalise = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * Best-effort human name from an email address.
 *
 * Handles the shapes addresses actually come in: dot, underscore, hyphen and
 * camelCase separators, plus-addressing, and trailing digits. Falls back to the
 * local part rather than inventing something when there is nothing to split on.
 */
export function displayNameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").split("+")[0] ?? "";
  if (!local) return email;

  const words = local
    .split(/[._\-\s]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .map((part) => part.replace(/\d+/g, ""))
    .filter(Boolean);

  if (words.length === 0) return local;
  return words.map(capitalise).join(" ");
}

/** One or two letters for the avatar. Never more — three stops fitting. */
export function initialsFromName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function nameFor(user: User): string {
  return user.displayName?.trim() || displayNameFromEmail(user.email);
}

/** First word of the display name — greetings, never the whole address. */
export function firstNameFor(user: User): string {
  return nameFor(user).split(/\s+/).filter(Boolean)[0] ?? "";
}
