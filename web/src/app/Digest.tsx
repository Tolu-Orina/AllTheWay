import { CheckCircle2, ChevronRight, FileText, Play } from "lucide-react";
import { useT } from "@/app/i18n";
import { Link } from "react-router";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Digest as DigestData } from "@/app/data";

/**
 * The morning digest — the manifest's 07:40 moment.
 *
 * ## Why this exists at all
 *
 * A spoken answer "leaves nothing behind and is gone the moment it ends". This
 * is what stays: the same information, on a screen, at a glance, on a phone
 * held one-handed on a train.
 *
 * ## Decisions first, always
 *
 * The ordering is the design. Everything except `awaitingDecision` is history —
 * interesting, not actionable. Putting the two things that need a person at the
 * top is what makes this a tool rather than a newsletter, and it is why the
 * counts matter less than the decisions.
 *
 * ## Nothing here confirms anything
 *
 * The decisions link through to the session where the full context and the
 * autonomy floor live. A one-tap "approve" on a summary line would be exactly
 * the confirmation-without-reading this product refuses everywhere else — and
 * on a phone, on a train, it would be the easiest place in the app to make an
 * expensive mistake.
 */
export function Digest() {
  const t = useT();
  const { state, reload } = useAsync<DigestData>(() => api.digest());

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("digest.heading")}
      </h2>

      <Async state={state} reload={reload}>
        {(digest) => {
          const quiet =
            digest.ranWatchers.length === 0 &&
            digest.awaitingDecision.length === 0 &&
            digest.artifactsChanged.length === 0;

          if (quiet) {
            return (
              <p className="rounded-brand border bg-card px-3.5 py-3 text-[13px] text-muted-foreground">
                {t("digest.quiet")}
              </p>
            );
          }

          return (
            <div className="flex flex-col gap-3">
              {digest.awaitingDecision.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-brand border border-primary/40 bg-primary/5 px-3.5 py-3">
                  <p className="text-[13px] font-medium">
                    {/* The plural form comes from Intl.PluralRules for the
                        current language, not an === 1 check. Welsh has six
                        categories; English's two are not a safe default. */}
                    {t("digest.decisions", { count: digest.awaitingDecision.length })}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {digest.awaitingDecision.map((d) => (
                      <li key={d.id}>
                        <Link
                          to="/app/sessions"
                          className="flex items-start justify-between gap-2 text-[13px] leading-relaxed underline-offset-2 hover:underline"
                        >
                          {/* Verbatim. A digest that paraphrases what someone
                              is approving is asking them to approve something
                              they did not read. */}
                          <span className="min-w-0">{d.summary}</span>
                          <ChevronRight
                            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-brand border bg-card px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  {t("digest.nothingWaiting")}
                </p>
              )}

              {digest.ranWatchers.length > 0 ? (
                <Group
                  icon={<Play className="size-3.5" aria-hidden="true" />}
                  label={
                      t("digest.watchersRan", { count: digest.ranWatchers.length })
                  }
                  items={digest.ranWatchers.map((r) => r.summary)}
                />
              ) : null}

              {digest.artifactsChanged.length > 0 ? (
                <Group
                  icon={<FileText className="size-3.5" aria-hidden="true" />}
                  label={
                      t("digest.changed", { count: digest.artifactsChanged.length })
                  }
                  items={digest.artifactsChanged.map((a) => a.title)}
                />
              ) : null}
            </div>
          );
        }}
      </Async>
    </section>
  );
}

function Group({
  icon,
  label,
  items,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
}) {
  const t = useT();
  return (
    <div className="rounded-brand border bg-card px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {icon}
        {label}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1">
        {/* Capped at four. A digest you scroll is a digest you skim, and the
            point of this surface is that it can be taken in at a glance. */}
        {items.slice(0, 4).map((text, i) => (
          <li key={i} className="truncate text-[13px]">
            {text}
          </li>
        ))}
        {items.length > 4 ? (
          <li className="text-[12px] text-muted-foreground">
            {t("digest.andMore", { count: items.length - 4 })}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
