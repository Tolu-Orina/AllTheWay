import { ShieldAlert } from "lucide-react";

/**
 * The stop before a standing instruction is created.
 *
 * Same shape as the session confirm gate, extracted here so Watchers can use
 * it without pulling SessionDetail apart. A live region, because the whole
 * point is that a person notices before agreeing.
 */
export function ConfirmGate({
  summary,
  actions,
  confirmLabel,
  declineLabel,
  busy = false,
  status,
  onConfirm,
  onDecline,
}: {
  summary: string;
  actions: { label: string; reason: string }[];
  confirmLabel: string;
  declineLabel: string;
  busy?: boolean;
  status?: string | null;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm before creating"
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
          </div>

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
