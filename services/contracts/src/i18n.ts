import { z } from "zod";

/**
 * The parts of interface translation that are decisions rather than rendering.
 *
 * ## Why this is here and not in the web app
 *
 * Plural selection, interpolation and locale negotiation are pure functions
 * with edge cases that are easy to get subtly wrong — and the web app has no
 * test runner. Putting them where one exists is the same reasoning that moved
 * `qualityOf` here.
 *
 * ## Why the shape is i18next's
 *
 * `{{name}}` interpolation, and `key_one` / `key_other` plural suffixes chosen
 * by `Intl.PluralRules`. That is exactly what i18next does.
 *
 * The implementation is sixty lines because the product needs sixty lines of
 * it: roughly four hundred strings of chrome, since the agent's own output is
 * already in the user's language. But the *format* is i18next's precisely so
 * that adopting the library later — when translators who do not use git need to
 * edit strings — costs nothing at any call site.
 */

/**
 * Languages the interface is available in.
 *
 * Deliberately short. A language listed here and half-translated is worse than
 * one absent: the user switches, sees English fragments, and learns the feature
 * is unreliable. `check-locales.py` fails the build on a missing key for exactly
 * that reason.
 */
export const LOCALES = ["en", "cy", "es", "fr", "pt", "yo", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  // Endonyms: a language is offered in its own language, because someone who
  // reads Yorùbá and not English cannot find "Yoruba" in an English list.
  en: "English",
  cy: "Cymraeg",
  es: "Español",
  fr: "Français",
  // Brazilian Portuguese. `pt-PT` differs enough in vocabulary that a European
  // reader notices immediately; adding it later is a new locale, not an edit.
  pt: "Português",
  yo: "Yorùbá",
  // Simplified. Traditional is `zh-Hant` and would need script-aware matching
  // in `offerFrom`, which currently compares language subtags only.
  zh: "中文",
};

export const LocaleSchema = z.enum(LOCALES);

/** A catalogue is nested objects of strings, as i18next expects. */
export type Catalogue = { [key: string]: string | Catalogue };

/** Resolve a dotted key against a nested catalogue. */
function lookup(catalogue: Catalogue, key: string): string | undefined {
  let node: string | Catalogue | undefined = catalogue;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Choose the plural form for a count.
 *
 * `Intl.PluralRules` rather than a hand-written rule, because plural categories
 * are not "one and everything else" outside English — Polish has three, Arabic
 * six — and a rule written by an English speaker is wrong in a way that reads as
 * illiteracy to a native reader.
 */
function pluralKey(key: string, count: number, locale: string): string {
  const category = new Intl.PluralRules(locale).select(count);
  return `${key}_${category}`;
}

/**
 * Substitute `{{name}}` placeholders.
 *
 * Values are inserted as text and never parsed. React escapes what it renders,
 * so a translated string cannot introduce markup — but a placeholder whose value
 * came from a meeting transcript should not be able to either.
 */
function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Translate one key.
 *
 * Falls back through the English catalogue and then to the key itself. The key
 * is deliberately the last resort rather than an empty string: a screen showing
 * `digest.title` is obviously broken, while a screen showing nothing looks like
 * a layout bug and gets diagnosed for hours.
 */
export function translate(
  key: string,
  opts: {
    catalogue: Catalogue;
    fallback?: Catalogue;
    locale: string;
    vars?: Record<string, unknown>;
  },
): string {
  const { catalogue, fallback, locale, vars = {} } = opts;

  const count = vars.count;
  const resolved =
    typeof count === "number"
      ? lookup(catalogue, pluralKey(key, count, locale)) ??
        lookup(fallback ?? {}, pluralKey(key, count, locale))
      : undefined;

  const template = resolved ?? lookup(catalogue, key) ?? lookup(fallback ?? {}, key) ?? key;
  return interpolate(template, vars);
}

/**
 * Which language to show, given what we know.
 *
 * The order is the whole design:
 *
 *  1. What the user chose. Stored server-side, so it follows them to a phone
 *     rather than being rediscovered per device.
 *  2. What their browser says — but see `offerFrom` below. This is used to
 *     *offer*, not to apply.
 *  3. English.
 *
 * **IP is deliberately absent.** Country is not language: a Nigerian in London
 * and an English speaker in Lagos are both mis-served by it, and being told what
 * language you speak is worse than being asked.
 */
export function resolveLocale(saved: string | null | undefined): Locale {
  if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  return DEFAULT_LOCALE;
}

/**
 * The language worth offering, if any.
 *
 * Returns a locale only when the browser's preference is one we actually have
 * *and* it is not what is already showing. Offering English to an English
 * speaker, or Yoruba we have not translated, are both noise — and a prompt that
 * is usually noise is a prompt people learn to dismiss without reading.
 *
 * `navigator.languages` is used because the user configured it. Matching is on
 * the language subtag: someone with `yo-NG` should be offered `yo`.
 */
export function offerFrom(
  browserLanguages: readonly string[],
  current: Locale,
): Locale | null {
  for (const tag of browserLanguages) {
    const base = tag.toLowerCase().split("-")[0];
    if (!base) continue;
    if (base === current) return null; // already right; nothing to offer
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return null;
}

/** Right-to-left scripts. Empty today; the plumbing exists so it can grow. */
export const RTL_LOCALES: readonly string[] = [];

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.includes(locale.toLowerCase().split("-")[0] ?? "");
}
