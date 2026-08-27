import {
  LOCALES,
  LOCALE_NAMES,
  SWITCH_LABELS,
  type Locale,
} from "@alltheway/contracts";
import { Languages } from "lucide-react";

import { useI18n, useT } from "@/app/i18n";

/**
 * Choosing the interface language.
 *
 * ## This is not the language you speak to it in
 *
 * Voice already detects 97 languages and handles switching mid-sentence, and
 * transcription does the same. Someone may well want a Yorùbá conversation with
 * an English interface, or the reverse. Collapsing the two into one setting
 * would take a choice away from exactly the users this product is for, so the
 * copy says plainly what this does and does not change.
 *
 * ## Names are in their own language
 *
 * "Yorùbá", not "Yoruba (Nigeria)". A person who reads Yorùbá and not English
 * cannot find their language in a list written in English.
 */
export function LanguageChoice() {
  const t = useT();
  const { locale, setLocale } = useI18n();

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("language.heading")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {t("language.hint")}
      </p>

      <div className="flex flex-wrap gap-2">
        {LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => void setLocale(option)}
            aria-pressed={option === locale}
            // `lang` so a screen reader pronounces each name in its own
            // language rather than reading Yorùbá with English phonetics.
            lang={option}
            className={
              option === locale
                ? "rounded-brand border border-primary bg-primary/10 px-3 py-1.5 text-[13px]"
                : "rounded-brand border px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
            }
          >
            {LOCALE_NAMES[option]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The offer.
 *
 * Shown only when the browser's stated preference is a language we actually
 * have and is not what is already showing — so most people never see it, which
 * is the point. A prompt that is usually noise is a prompt people learn to
 * dismiss without reading.
 *
 * Deliberately not an onboarding step: adding one would tax every user for a
 * minority case. Home shows it after a first win so it cannot fight the job
 * screen; You always can. If the locale is already set, `offer` is null.
 */
export function LanguageOffer({ show = true }: { show?: boolean }) {
  const t = useT();
  const { offer, setLocale, dismissOffer } = useI18n();
  if (!show || !offer) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-brand border bg-card px-3.5 py-2.5 text-[13px]"
    >
      <Languages className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      {/* In the offered language, not in English: someone who cannot read the
          current interface still needs to understand the offer. */}
      <span lang={offer}>{LOCALE_NAMES[offer as Locale]}?</span>
      <button
        type="button"
        onClick={() => void setLocale(offer)}
        className="rounded-brand border px-2.5 py-1 text-[12.5px] transition-colors hover:bg-muted"
      >
        <span lang={offer}>{SWITCH_LABELS[offer as Locale]}</span>
      </button>
      <button
        type="button"
        onClick={dismissOffer}
        className="text-[12.5px] text-muted-foreground underline underline-offset-2"
      >
        {t("language.dismiss")}
      </button>
    </div>
  );
}
