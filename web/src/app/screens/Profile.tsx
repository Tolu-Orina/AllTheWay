import { useState } from "react";
import { useT } from "@/app/i18n";
import { Check, Undo2 } from "lucide-react";

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
import { LanguageChoice } from "@/app/LanguageChoice";

export default function Profile() {
  const t = useT();
  const { state, reload } = useAsync<LearnedPreference[]>(() =>
    api.preferences(),
  );

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

  const visible = (rows: LearnedPreference[]) =>
    rows.filter((r) => !revertedIds.includes(r.id));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
          {t("common.cognitiveProfile")}
        </h1>
        <p className="mt-1 max-w-prose text-[14px] leading-relaxed text-muted-foreground">
          {t("common.builtFromWhatYouActuallyDid")}
        </p>
      </header>

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
                  <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
                    {item.area}
                  </h2>
                  <button
                    type="button"
                    onClick={() => revert(item)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Undo2 className="size-3.5" aria-hidden="true" />
                    Revert
                  </button>
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

      <LanguageChoice />

      <VoiceTranscripts />

      <SharedWithMe />

      <Meetings />

      <Documents />

      <Usage />

      <Connections />
    </div>

  );
}
