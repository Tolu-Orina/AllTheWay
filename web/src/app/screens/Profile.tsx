import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useT } from "@/app/i18n";
import { Check, LogOut, Undo2 } from "lucide-react";

import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type LearnedPreference } from "@/app/data";
import { Connections } from "@/app/Connections";
import { Usage } from "@/app/Usage";
import { Documents } from "@/app/Documents";
import { VisualPreferences } from "@/app/VisualPreferences";
import { Meetings } from "@/app/Meetings";
import { SharedWithMe } from "@/app/SharedWithMe";
import { VoiceTranscripts } from "@/app/VoiceTranscripts";
import { LanguageChoice, LanguageOffer } from "@/app/LanguageChoice";
import { useAuth } from "@/auth/useAuth";

/**
 * You — account, memory, and what is running. Not the product.
 *
 * Section order is the design: plan first, learned memory, language, accounts,
 * libraries, registry collapsed, then sign out. Upgrade starts Checkout;
 * Manage plan opens the Stripe Customer Portal.
 */
export default function Profile() {
  const t = useT();
  const navigate = useNavigate();
  const { adapter } = useAuth();
  const { state, reload } = useAsync<LearnedPreference[]>(() =>
    api.preferences(),
  );
  const concepts = useAsync(() => api.concepts(), []);

  // Reverted ids only; the list is derived during render.
  const [revertedIds, setRevertedIds] = useState<string[]>([]);
  const [reverted, setReverted] = useState<string | null>(null);

  const [failure, setFailure] = useState<string | null>(null);

  async function revert(item: LearnedPreference) {
    setFailure(null);
    setRevertedIds((prev) => [...prev, item.id]);
    // Confirmation is specific about what happened, not a bare "Success!".
    setReverted(item.area);
    try {
      await api.revertPreference(item.id);
    } catch {
      setRevertedIds((prev) => prev.filter((id) => id !== item.id));
      setReverted(null);
      setFailure("We could not revert that. Nothing changed — try again.");
    }
  }

  async function signOut() {
    await adapter.signOut();
    navigate("/login", { replace: true });
  }

  const visible = (rows: LearnedPreference[]) =>
    rows.filter((r) => !revertedIds.includes(r.id));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
          {t("nav.you")}
        </h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          {t("you.tagline")}
        </p>
      </header>

      <Usage heading={t("you.plan")} />

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
          {t("you.learned")}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          {t("common.builtFromWhatYouActuallyDid")}
        </p>

        {reverted ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-brand border bg-accent px-4 py-3 text-[13px] text-accent-foreground"
          >
            <Check className="size-4 shrink-0" aria-hidden="true" />
            {reverted} reverted — the companion will ask you about it next time
            instead of assuming.
          </p>
        ) : null}

        {failure ? (
          <p
            role="alert"
            className="rounded-brand border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive"
          >
            {failure}
          </p>
        ) : null}

        <Async
          state={state}
          reload={reload}
          isEmpty={(rows) => visible(rows).length === 0}
          empty={
            <EmptyState
              title="Nothing learned yet"
              body="As you correct the companion, what it infers will appear here — each entry with the evidence behind it."
            />
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-3">
              {visible(rows).map((item) => (
                <li
                  key={item.id}
                  className="rounded-brand-lg border bg-card p-4 shadow-e1 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
                      {item.area}
                      {item.hat ? ` · ${t(`life.hat${item.hat[0]!.toUpperCase()}${item.hat.slice(1)}`)}` : ""}
                      {item.proposed ? ` · ${t("memory.suggested")}` : ""}
                    </h3>
                    <div className="flex shrink-0 gap-1.5">
                      {item.proposed ? (
                        <button
                          type="button"
                          onClick={() => {
                            void api.acceptPreference(item.id).then(() => reload());
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {t("memory.acceptSuggestion")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => revert(item)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Undo2 className="size-3.5" aria-hidden="true" />
                        {t("memory.revert")}
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-[14px] text-muted-foreground line-through decoration-destructive/60">
                    {item.was}
                  </p>
                  <p className="mt-1.5 rounded-[6px] bg-accent px-2.5 py-1.5 text-[14px] font-medium text-accent-foreground">
                    {item.now}
                  </p>
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    {item.evidence}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Async>

        <VisualPreferences />

        <h2 className="mt-2 text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
          {t("memory.struggles")}
        </h2>
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          {t("memory.strugglesHint")}
        </p>
        <Async
          state={concepts.state}
          reload={concepts.reload}
          isEmpty={(rows) => rows.length === 0}
          empty={
            <EmptyState
              title={t("memory.strugglesEmpty")}
              body={t("memory.strugglesHint")}
            />
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-3">
              {rows.map((item) => (
                <li
                  key={item.id}
                  className="rounded-brand-lg border bg-card p-4 shadow-e1 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-[14px] font-medium">{item.label}</h3>
                    <button
                      type="button"
                      onClick={() => {
                        void api.revertConcept(item.id).then(() => concepts.reload());
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Undo2 className="size-3.5" aria-hidden="true" />
                      {t("memory.revert")}
                    </button>
                  </div>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    {t("memory.reaskedCount", { count: String(item.reasked) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
          {t("you.languageVoice")}
        </h2>
        <LanguageOffer />
        <LanguageChoice />
        <VoiceTranscripts />
      </section>

      <Connections />

      <section id="documents" className="flex scroll-mt-24 flex-col gap-3">
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
          {t("you.libraries")}
        </h2>
        <SharedWithMe />
        <Meetings />
        <Documents />
      </section>

      <details className="rounded-brand-lg border bg-card p-4 shadow-e1">
        <summary className="cursor-pointer text-[16px] font-semibold tracking-[-0.01em]">
          {t("you.whatsRunning")}
        </summary>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          {t("you.whatsRunningHint")}
        </p>
        <Link
          to="/app/you/running"
          className="mt-3 inline-block text-[13px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {t("you.seeRunning")}
        </Link>
      </details>

      <button
        type="button"
        onClick={() => void signOut()}
        className="inline-flex items-center gap-2 self-start text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="size-4" aria-hidden="true" />
        {t("account.signOut")}
      </button>
    </div>
  );
}
