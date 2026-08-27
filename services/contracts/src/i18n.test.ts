import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  isRtl,
  offerFrom,
  resolveLocale,
  translate,
  type Catalogue,
} from "./i18n.js";

const en: Catalogue = {
  digest: {
    title: "Since yesterday",
    decisions_one: "One thing needs your decision",
    decisions_other: "{{count}} things need your decision",
  },
  greeting: "Good morning, {{name}}",
};

const yo: Catalogue = {
  digest: {
    title: "Láti àná",
  },
};

test("a key resolves through nested objects", () => {
  strictEqual(translate("digest.title", { catalogue: en, locale: "en" }), "Since yesterday");
});

test("a missing key falls back to English, then to itself", () => {
  // English first: a Yoruba screen with one English line is imperfect but
  // usable. The key last, and visibly: `digest.missing` on screen is obviously
  // broken, while an empty string looks like a layout bug and gets diagnosed
  // for hours.
  strictEqual(
    translate("digest.decisions_one", { catalogue: yo, fallback: en, locale: "yo" }),
    "One thing needs your decision",
  );
  strictEqual(translate("nothing.here", { catalogue: yo, fallback: en, locale: "yo" }), "nothing.here");
});

test("placeholders are filled", () => {
  strictEqual(
    translate("greeting", { catalogue: en, locale: "en", vars: { name: "Ada" } }),
    "Good morning, Ada",
  );
});

test("a placeholder with no value is left visible rather than blanked", () => {
  // "Good morning, " reads as a bug in the data. "{{name}}" reads as a bug in
  // the code, which is what it is.
  strictEqual(translate("greeting", { catalogue: en, locale: "en" }), "Good morning, {{name}}");
});

test("plurals use the locale's own categories", () => {
  strictEqual(
    translate("digest.decisions", { catalogue: en, locale: "en", vars: { count: 1 } }),
    "One thing needs your decision",
  );
  strictEqual(
    translate("digest.decisions", { catalogue: en, locale: "en", vars: { count: 3 } }),
    "3 things need your decision",
  );
});

test("zero is not the singular", () => {
  // English puts 0 in `other`. Writing "1 thing" for zero is the classic
  // hand-rolled-plural bug.
  strictEqual(
    translate("digest.decisions", { catalogue: en, locale: "en", vars: { count: 0 } }),
    "0 things need your decision",
  );
});

test("plural categories are not assumed to be English's", () => {
  /**
   * The reason `Intl.PluralRules` is used rather than `count === 1`.
   *
   * Polish has three categories and picks a different one for 2 and for 5.
   * A rule written by an English speaker is wrong in a way that reads as
   * illiteracy to a native reader.
   */
  const pl = new Intl.PluralRules("pl");
  ok(new Set([pl.select(1), pl.select(2), pl.select(5)]).size > 2, "Polish collapsed to two forms");
});

test("interpolation cannot inject markup", () => {
  // Values are inserted as text and never parsed. React escapes what it
  // renders, but a placeholder fed from a meeting transcript should not be
  // able to introduce markup either.
  const out = translate("greeting", {
    catalogue: en,
    locale: "en",
    vars: { name: "<script>alert(1)</script>" },
  });
  strictEqual(out, "Good morning, <script>alert(1)</script>");
  ok(!out.includes("&lt;"), "the layer should not double-escape; React does that");
});

test("a saved preference wins", () => {
  strictEqual(resolveLocale("yo"), "yo");
});

test("an unknown or absent preference falls back to English", () => {
  // A corrupted setting must not render an interface nobody can read.
  strictEqual(resolveLocale("kl"), DEFAULT_LOCALE);
  strictEqual(resolveLocale(null), DEFAULT_LOCALE);
  strictEqual(resolveLocale(undefined), DEFAULT_LOCALE);
});

test("the browser is offered, never applied", () => {
  // A language we have, that is not what is showing.
  strictEqual(offerFrom(["yo-NG", "en-GB"], "en"), "yo");
});

test("nothing is offered when the browser already agrees", () => {
  strictEqual(offerFrom(["en-GB", "en"], "en"), null);
});

test("nothing is offered for a language we do not have", () => {
  // A prompt that is usually noise is a prompt people dismiss without reading.
  // German and Japanese, deliberately: this test previously used French, and
  // adding French as a real locale turned it into a test of nothing.
  strictEqual(offerFrom(["de-DE", "ja-JP"], "en"), null);
});

test("each supported language is offered to a browser asking for it", () => {
  // The complement of the test above, so "offers nothing" can never pass by
  // the machinery being broken.
  for (const locale of LOCALES.filter((l) => l !== "en")) {
    strictEqual(offerFrom([`${locale}-XX`, "en"], "en"), locale);
  }
});

test("a region subtag still matches its language", () => {
  strictEqual(offerFrom(["yo-BJ"], "en"), "yo");
});

test("the first understood language wins", () => {
  // navigator.languages is ordered by preference. Scanning past the user's
  // first choice to find one we like better would be overriding them.
  strictEqual(offerFrom(["en-US", "yo"], "en"), null);
});

test("every locale has a name in its own language", () => {
  // Someone who reads Yoruba and not English cannot find "Yoruba" in a list.
  for (const locale of LOCALES) {
    ok(LOCALE_NAMES[locale]?.length > 0, `${locale} has no endonym`);
  }
});

test("rtl is plumbed but claims nothing yet", () => {
  // Empty on purpose. The hook exists so adding Arabic is a data change rather
  // than a search for every place direction matters.
  strictEqual(isRtl("en"), false);
  strictEqual(isRtl("yo"), false);
});
