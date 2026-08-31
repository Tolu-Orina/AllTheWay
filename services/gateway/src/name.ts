/**
 * A first name we can say out loud.
 *
 * Greetings use this, never the whole address. Same splitting rules as the
 * web's `displayNameFromEmail` / `firstNameFor` — kept here so the gateway
 * does not import the SPA.
 */

const capitalise = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

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

/** Strip control characters and quotes so a name can sit inside a spoken prompt. */
export function speakable(value: string, cap: number): string {
  return value
    .replace(/[\r\n\u0000-\u001f]+/g, " ")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

export function firstNameFrom(opts: { name?: string; email?: string }): string {
  const raw = opts.name?.trim();
  const source =
    raw && !raw.includes("@") ? raw : displayNameFromEmail(opts.email ?? "");
  const first = source.split(/\s+/).filter(Boolean)[0] ?? "";
  return speakable(first, 24);
}
