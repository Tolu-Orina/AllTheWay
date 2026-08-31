import { useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { api } from "@/app/data";
import { useT } from "@/app/i18n";
import {
  argString,
  composeKind,
  composeSources,
  composeStep,
  fromDatetimeLocal,
  toDatetimeLocal,
  type ComposeSource,
} from "@/app/compose-fields";
import { setComposeFlush } from "@/app/compose-flush";

/** Latest unanswered write-plan. A later `done` note must not hide Yes. */
export function pendingConfirmId(
  messages: Array<{
    id: number;
    role: string;
    phase?: string;
    actions?: Array<{ connector?: string; tool?: string }>;
  }>,
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null;
    if (m.role !== "agent") continue;
    if (m.phase === "confirm") return m.id;
    if ((m.actions ?? []).some((a) => a.connector && a.tool)) {
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
 * Email and calendar writes are an editable compose on this same surface —
 * not a second dialog. Field tweaks persist onto the stored plan; Yes (spoken
 * or clicked) replays those arguments. `onCorrect` is optional: Watchers do
 * not pass it.
 */
export function ConfirmGate({
  summary,
  actions,
  confirmLabel,
  declineLabel,
  busy = false,
  status,
  dialogLabel = "Confirm before acting",
  sessionId,
  steps,
  onConfirm,
  onDecline,
  onCorrect,
}: {
  summary: string;
  actions: { label: string; reason: string; connector?: string; tool?: string; arguments?: Record<string, unknown> }[];
  confirmLabel: string;
  declineLabel: string;
  busy?: boolean;
  status?: string | null;
  dialogLabel?: string;
  sessionId?: string;
  steps?: ComposeSource[];
  onConfirm: () => void;
  onDecline: () => void;
  onCorrect?: (now: string) => void;
}) {
  const t = useT();
  const [amending, setAmending] = useState(false);
  const [instead, setInstead] = useState("");

  const sources = composeSources(steps, actions);
  const kind = composeKind(sources);
  const confirmText =
    kind === "email" ? t("compose.saveDraft") : kind === "calendar" ? t("compose.putOnCalendar") : confirmLabel;

  const compose = useComposeFields(sources, kind, sessionId);
  const emailReady =
    kind !== "email" ||
    (compose !== null && "to" in compose.fields && compose.fields.to.includes("@"));

  return (
    <div
      role="alertdialog"
      aria-label={dialogLabel}
      aria-live="assertive"
      className={
        kind
          ? "rounded-brand border bg-background p-4"
          : "rounded-brand border-2 border-destructive/40 bg-destructive/5 p-4"
      }
    >
      <div className="flex gap-2.5">
        {kind ? null : (
          <ShieldAlert
            className="mt-0.5 size-5 shrink-0 text-destructive"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-relaxed font-medium">{summary}</p>

          {kind && compose ? (
            <ComposeForm
              kind={kind}
              fields={compose.fields}
              onChange={compose.setFields as (next: EmailFields | CalendarFields) => void}
              disabled={busy}
            />
          ) : actions.length > 0 ? (
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
              disabled={busy || !emailReady}
              onClick={() => {
                void (async () => {
                  await compose?.flush();
                  onConfirm();
                })();
              }}
              className="rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {confirmText}
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

type EmailFields = { to: string; subject: string; body: string };
type CalendarFields = { title: string; starts: string; timeZone: string; attendees: string };

function useComposeFields(
  sources: ComposeSource[],
  kind: "email" | "calendar" | null,
  sessionId: string | undefined,
) {
  const step = kind ? composeStep(sources, kind) : null;
  const incomingEmail: EmailFields = {
    to: argString(step?.arguments, "to"),
    subject: argString(step?.arguments, "subject"),
    body: argString(step?.arguments, "body"),
  };
  const incomingCalendar: CalendarFields = {
    title: argString(step?.arguments, "title"),
    starts: toDatetimeLocal(argString(step?.arguments, "starts_at")),
    timeZone: argString(step?.arguments, "time_zone") || "Europe/London",
    attendees: argString(step?.arguments, "attendees"),
  };
  const [email, setEmail] = useState<EmailFields>(incomingEmail);
  const [calendar, setCalendar] = useState<CalendarFields>(incomingCalendar);

  useEffect(() => {
    if (kind !== "email") return;
    setEmail((prev) =>
      prev.to === incomingEmail.to &&
      prev.subject === incomingEmail.subject &&
      prev.body === incomingEmail.body
        ? prev
        : incomingEmail,
    );
  }, [kind, incomingEmail.to, incomingEmail.subject, incomingEmail.body]);

  useEffect(() => {
    if (kind !== "calendar") return;
    setCalendar((prev) =>
      prev.title === incomingCalendar.title &&
      prev.starts === incomingCalendar.starts &&
      prev.timeZone === incomingCalendar.timeZone &&
      prev.attendees === incomingCalendar.attendees
        ? prev
        : incomingCalendar,
    );
  }, [
    kind,
    incomingCalendar.title,
    incomingCalendar.starts,
    incomingCalendar.timeZone,
    incomingCalendar.attendees,
  ]);

  const first = useRef(true);
  const pending = useRef(Promise.resolve());
  const gen = useRef(0);

  const patch =
    kind === "email"
      ? {
          connector: "google_gmail",
          tool: "create_draft",
          arguments: { to: email.to, subject: email.subject, body: email.body },
        }
      : kind === "calendar"
        ? {
            connector: "google_calendar",
            tool: "create_event",
            arguments: {
              title: calendar.title,
              starts_at: fromDatetimeLocal(calendar.starts),
              time_zone: calendar.timeZone.trim() || "Europe/London",
              attendees: calendar.attendees,
            },
          }
        : null;

  useEffect(() => {
    if (!sessionId || !kind) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const next =
      kind === "email"
        ? {
            connector: "google_gmail",
            tool: "create_draft",
            arguments: { to: email.to, subject: email.subject, body: email.body },
          }
        : {
            connector: "google_calendar",
            tool: "create_event",
            arguments: {
              title: calendar.title,
              starts_at: fromDatetimeLocal(calendar.starts),
              time_zone: calendar.timeZone.trim() || "Europe/London",
              attendees: calendar.attendees,
            },
          };
    const mine = ++gen.current;
    const handle = window.setTimeout(() => {
      if (mine !== gen.current) return;
      pending.current = api
        .patchPlanArgs(sessionId, [next])
        .then(() => undefined)
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [
    sessionId,
    kind,
    email.to,
    email.subject,
    email.body,
    calendar.title,
    calendar.starts,
    calendar.timeZone,
    calendar.attendees,
  ]);

  const flush = async () => {
    if (!sessionId || !patch) return;
    gen.current += 1;
    pending.current = api.patchPlanArgs(sessionId, [patch]).then(() => undefined).catch(() => undefined);
    await pending.current;
  };

  useEffect(() => {
    if (!sessionId || !kind) return;
    return setComposeFlush(sessionId, flush);
  }, [
    sessionId,
    kind,
    email.to,
    email.subject,
    email.body,
    calendar.title,
    calendar.starts,
    calendar.timeZone,
    calendar.attendees,
  ]);

  if (!kind || !step) return null;

  if (kind === "email") {
    return { fields: email, setFields: setEmail, flush };
  }
  return { fields: calendar, setFields: setCalendar, flush };
}

function ComposeForm({
  kind,
  fields,
  onChange,
  disabled,
}: {
  kind: "email" | "calendar";
  fields: EmailFields | CalendarFields;
  onChange: (next: EmailFields | CalendarFields) => void;
  disabled: boolean;
}) {
  const t = useT();
  const fieldClass =
    "mt-1 w-full rounded-brand border bg-background px-3 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground disabled:opacity-60";

  if (kind === "email") {
    const email = fields as EmailFields;
    return (
      <div className="mt-3 space-y-2.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.to")}
          <input
            type="text"
            autoComplete="email"
            value={email.to}
            disabled={disabled}
            onChange={(e) => onChange({ ...email, to: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.subject")}
          <input
            type="text"
            value={email.subject}
            disabled={disabled}
            onChange={(e) => onChange({ ...email, subject: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.body")}
          <textarea
            rows={6}
            value={email.body}
            disabled={disabled}
            onChange={(e) => onChange({ ...email, body: e.target.value })}
            className="mt-1 w-full resize-y rounded-brand border bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
        </label>
      </div>
    );
  }

  const cal = fields as CalendarFields;
  return (
    <div className="mt-3 space-y-2.5">
      <label className="block text-[12px] font-medium text-muted-foreground">
        {t("compose.title")}
        <input
          type="text"
          value={cal.title}
          disabled={disabled}
          onChange={(e) => onChange({ ...cal, title: e.target.value })}
          className={fieldClass}
        />
      </label>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.starts")}
          <input
            type="datetime-local"
            value={cal.starts}
            disabled={disabled}
            onChange={(e) => onChange({ ...cal, starts: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.timeZone")}
          <input
            type="text"
            value={cal.timeZone}
            disabled={disabled}
            onChange={(e) => onChange({ ...cal, timeZone: e.target.value })}
            className={fieldClass}
          />
        </label>
      </div>
      <label className="block text-[12px] font-medium text-muted-foreground">
        {t("compose.attendees")}
        <input
          type="text"
          value={cal.attendees}
          disabled={disabled}
          onChange={(e) => onChange({ ...cal, attendees: e.target.value })}
          placeholder={t("compose.attendeesHint")}
          className={fieldClass}
        />
      </label>
    </div>
  );
}
