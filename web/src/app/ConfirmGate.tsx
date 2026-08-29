import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { useT } from "@/app/i18n";

/** Latest unanswered write-plan. A later `done` note must not hide Yes. */
export function pendingConfirmId(
  messages: Array<{
    id: number;
    role: string;
    actions?: Array<{ connector?: string; tool?: string }>;
  }>,
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null;
    if (m.role === "agent" && (m.actions ?? []).some((a) => a.connector && a.tool)) {
      return m.id;
    }
  }
  return null;
}

/**
 * The stop before something with a side effect happens.
 *
 * Same shape for Watchers, meetings, and session Yes. A live region, because
 * the whole point is that a person notices before agreeing.
 *
 * `onCorrect` is optional on purpose: creating a Watcher is not a preference
 * about how to do the work, and a third button there would invent a learning
 * signal that does not exist. Session and voice pass it; Watchers do not.
 */
export function ConfirmGate({
  summary,
  actions,
  confirmLabel,
  declineLabel,
  busy = false,
  status,
  dialogLabel = "Confirm before acting",
  onConfirm,
  onDecline,
  onCorrect,
}: {
  summary: string;
  actions: { label: string; reason: string }[];
  confirmLabel: string;
  declineLabel: string;
  busy?: boolean;
  status?: string | null;
  dialogLabel?: string;
  onConfirm: () => void;
  onDecline: () => void;
  onCorrect?: (now: string) => void;
}) {
  const t = useT();
  const [amending, setAmending] = useState(false);
  const [instead, setInstead] = useState("");

  return (
    <div
      role="alertdialog"
      aria-label={dialogLabel}
      aria-live="assertive"
      className="rounded-brand border-2 border-destructive/40 bg-destructive/5 p-4"
    >
      <div className="flex gap-2.5">
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-[14px] leading-relaxed font-medium">{summary}</p>

          {actions.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {actions.map((a) => (
                <li key={a.label} className="text-[13px] text-muted-foreground">
                  <span className="text-foreground">{a.label}</span>
                  {" — "}
                  {a.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {confirmLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {declineLabel}
            </button>
            {onCorrect && !amending ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAmending(true)}
                className="rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
              >
                {t("common.notQuite")}
              </button>
            ) : null}
          </div>

          {onCorrect && amending ? (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const next = instead.trim();
                if (!next || busy) return;
                onCorrect(next);
                setInstead("");
                setAmending(false);
              }}
            >
              <label htmlFor="confirm-instead" className="sr-only">
                {t("common.insteadPlaceholder")}
              </label>
              <input
                id="confirm-instead"
                value={instead}
                onChange={(e) => setInstead(e.target.value)}
                disabled={busy}
                placeholder={t("common.insteadPlaceholder")}
                className="min-w-0 flex-1 rounded-full border bg-background px-3 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!instead.trim() || busy}
                className="rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {t("common.rememberThis")}
              </button>
            </form>
          ) : null}

          {status ? (
            <p role="status" className="mt-2.5 text-[13px] text-muted-foreground">
              {status}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
