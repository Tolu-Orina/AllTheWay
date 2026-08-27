import { useState } from "react";
import { useT } from "@/app/i18n";
import { Loader2, Mic } from "lucide-react";

import { useAsync } from "@/app/use-async";
import { api } from "@/app/data";

/**
 * Whether spoken conversations are kept.
 *
 * ## Why this is a switch and not a default
 *
 * Voice has been ephemeral: captions appeared, overwrote each other, and were
 * gone when the session closed. Turning that into a durable record is a change
 * in what this product remembers about a person — closer to a decision than a
 * feature — so it is off until someone chooses it.
 *
 * ## The wording says what it is for
 *
 * "Keep a record" rather than "improve your experience". People switch this on
 * for reviews and audits, and the copy should match the reason rather than
 * dress it up. It also says plainly that both halves are kept: an audit of what
 * was agreed needs the answer as well as the question.
 */
export function VoiceTranscripts() {
  const t = useT();
  const { state, reload } = useAsync(() => api.keepsTranscripts());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const keeping = state.status === "ready" ? state.data.keepTranscripts : false;

  async function toggle(next: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      await api.setKeepTranscripts(next);
      await reload();
    } catch {
      // A retention switch that looks changed but was not saved is the worst
      // possible failure for this particular control.
      setFailure(t("common.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("voice.heading")}
      </h2>

      <label className="flex items-start gap-2.5 rounded-brand border bg-card px-3.5 py-3">
        <input
          type="checkbox"
          checked={keeping}
          disabled={busy || state.status !== "ready"}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-0.5 size-4 shrink-0"
        />
        <span className="text-[13px] leading-relaxed">
          {t("voice.keep")}
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            {t("voice.keepHint")}
          </span>
        </span>
        {busy ? (
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : null}
      </label>

      {failure ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {failure}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The record of one conversation.
 *
 * Shown on the session it belongs to rather than in a list of its own: a
 * transcript is only meaningful next to what was decided, and a separate
 * "recordings" screen would invite reading them as a corpus rather than as
 * evidence for a particular decision.
 */
export function SessionTranscript({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { state, reload } = useAsync(() => api.transcript(sessionId));
  const [forgetting, setForgetting] = useState(false);

  if (state.status !== "ready" || state.data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
          <Mic className="size-3.5" aria-hidden="true" />
          {t("voice.whatWasSaid")}
        </h3>
        <button
          type="button"
          disabled={forgetting}
          onClick={async () => {
            setForgetting(true);
            try {
              // One call. The batching happens server-side, so a closed tab
              // cannot leave half a record behind.
              await api.forgetTranscript(sessionId);
              await reload();
            } finally {
              setForgetting(false);
            }
          }}
          className="text-[12px] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
        >
          {forgetting ? t("voice.deleting") : t("voice.deleteRecord")}
        </button>
      </div>

      <ol className="flex flex-col gap-1.5">
        {state.data.map((line, i) => (
          <li key={`${line.at}-${i}`} className="text-[13px] leading-relaxed">
            <span className="text-muted-foreground">
              {line.side === "user" ? "You" : "It"}:{" "}
            </span>
            {line.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
