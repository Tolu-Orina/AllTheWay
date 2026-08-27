import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LOCALE,
  isRtl,
  offerFrom,
  resolveLocale,
  translate,
  type Catalogue,
  type Locale,
} from "@alltheway/contracts";

import en from "@/locales/en.json";
import { api } from "@/app/data";

/**
 * Interface language.
 *
 * ## English is bundled; everything else is fetched
 *
 * The fallback must never depend on the network — a user whose connection drops
 * mid-switch should see English, not an empty screen. Other locales are a
 * dynamic import, so a French user never downloads Yoruba and an English user
 * downloads neither.
 *
 * ## The preference lives on the server
 *
 * Not in localStorage. Someone who sets their language on a laptop and opens the
 * app on a phone has expressed a preference about *themselves*, not about that
 * browser — and rediscovering it per device is how a setting feels broken.
 *
 * localStorage is still written, as a cache: it makes the first paint after a
 * reload correct rather than English-then-flicker.
 */

const CACHE_KEY = "alltheway:locale";

/**
 * Every catalogue, each as its own chunk.
 *
 * English is present here but never loaded through it — `load` returns the
 * static import instead. Rollup warns that a module imported both statically
 * and dynamically cannot be split, which is true, and is precisely the
 * behaviour English needs: a fallback that requires the network is not one.
 */
const catalogues = import.meta.glob<{ default: Catalogue }>("../locales/*.json");

interface I18n {
  locale: Locale;
  t: (key: string, vars?: Record<string, unknown>) => string;
  setLocale: (locale: Locale) => Promise<void>;
  /** A language worth offering, or null. Never applied automatically. */
  offer: Locale | null;
  dismissOffer: () => void;
}

const Context = createContext<I18n | null>(null);

function cached(): Locale | null {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    return value ? resolveLocale(value) : null;
  } catch {
    // Private windows and blocked site data both throw. Neither is a reason to
    // fail to render an interface.
    return null;
  }
}

async function load(locale: Locale): Promise<Catalogue> {
  // English is returned from the static import, never fetched. Rollup reports
  // that it cannot split a module imported both ways — true, and intended for
  // English alone.
  if (locale === DEFAULT_LOCALE) return en as Catalogue;
  const loader = catalogues[`../locales/${locale}.json`];
  if (!loader) return en as Catalogue;
  try {
    return (await loader()).default;
  } catch {
    // A chunk that will not load is a network problem, not a reason to show
    // nothing. English is always present.
    return en as Catalogue;
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => cached() ?? DEFAULT_LOCALE);
  const [catalogue, setCatalogue] = useState<Catalogue>(en as Catalogue);
  const [offer, setOffer] = useState<Locale | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // The server's answer wins over the cache, once it arrives.
  useEffect(() => {
    let live = true;
    void api
      .locale()
      .then(({ locale: saved }) => {
        if (!live || !saved) return;
        const resolved = resolveLocale(saved);
        setLocaleState(resolved);
        try {
          localStorage.setItem(CACHE_KEY, resolved);
        } catch {
          // See `cached`.
        }
      })
      .catch(() => {
        // Not signed in yet, or offline. The cache or English still applies.
      });
    return () => void (live = false);
  }, []);

  useEffect(() => {
    let live = true;
    void load(locale).then((next) => {
      if (live) setCatalogue(next);
    });

    document.documentElement.lang = locale;
    // Set even when false, so switching away from an RTL language restores it.
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";

    return () => void (live = false);
  }, [locale]);

  // Offered, never applied. See contracts/i18n.ts for why IP is not consulted.
  useEffect(() => {
    if (dismissed) return setOffer(null);
    setOffer(offerFrom(navigator.languages ?? [], locale));
  }, [locale, dismissed]);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    setDismissed(true);
    try {
      localStorage.setItem(CACHE_KEY, next);
    } catch {
      // See `cached`.
    }
    // Written server-side so the choice follows the person, not the browser.
    await api.setLocale(next).catch(() => {});
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      t: (key, vars) =>
        translate(key, { catalogue, fallback: en as Catalogue, locale, vars }),
      setLocale,
      offer,
      dismissOffer: () => setDismissed(true),
    }),
    [catalogue, locale, offer, setLocale],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(Context);
  if (!value) {
    // A component rendering outside the provider would otherwise show its keys,
    // which is confusing in a way that points at the wrong problem.
    throw new Error("useI18n must be used inside <I18nProvider>.");
  }
  return value;
}

/** The common case: just the translator. */
export function useT(): I18n["t"] {
  return useI18n().t;
}
