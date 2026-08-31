import { useEffect, useRef, useState } from "react";
import { Check, ShieldAlert } from "lucide-react";
import type { ActOutcome } from "@alltheway/contracts";

import { api } from "@/app/data";
import { calendarZone } from "@/app/clock";
import { useT } from "@/app/i18n";
import { settledHeadline } from "@/app/plan-copy";
import {
  argString,
  composeKind,
  composeSources,
  composeStep,
  documentBodyFromArgs,
  fromDatetimeLocal,
  isComposeReview,
  toDatetimeLocal,
  type ComposeKind,
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
    steps?: ComposeSource[];
  }>,
): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null;
    if (m.role !== "agent") continue;
    if (m.phase === "done" || m.phase === "error" || m.phase === "clarify") return null;
    if (m.phase === "confirm") return m.id;
    if ((m.actions ?? []).some((a) => a.connector && a.tool)) {
      return m.id;
    }
    if (isComposeReview(composeSources(m.steps, m.actions))) {
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
 * Email, calendar, and session-file writes are an editable compose on this
 * same surface — not a second dialog. Field tweaks persist onto the stored
 * plan; Yes (spoken or clicked) replays those arguments. `onCorrect` is
 * optional: Watchers do not pass it.
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
  recorded,
  decision,
  did,
  showSummary = true,
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
  recorded?: "pending" | "ok" | "failed";
  decision?: "confirmed" | "declined" | "corrected" | null;
  did?: ActOutcome[];
  showSummary?: boolean;
}) {
  const t = useT();
  const [amending, setAmending] = useState(false);
  const [instead, setInstead] = useState("");
  const closed =
    recorded === "ok" &&
    (decision === "confirmed" || decision === "declined" || decision === "corrected");

  const sources = composeSources(steps, actions);
  const kind = composeKind(sources);
  const formOnPlan = Boolean(kind && (steps?.length ?? 0) > 0);
  const documentTool = kind === "document" ? composeStep(sources, "document")?.tool : undefined;
  const confirmText =
    kind === "email"
      ? t("compose.saveDraft")
      : kind === "calendar"
        ? t("compose.putOnCalendar")
        : kind === "document"
          ? documentConfirmLabel(documentTool, t, confirmLabel)
          : confirmLabel;

  const compose = useComposeFields(sources, kind, formOnPlan ? undefined : sessionId);
  const documentReady =
    kind !== "document" ||
    (compose !== null && "title" in compose.fields && compose.fields.title.trim().length > 0);
  // A Gmail draft is not a send. Asking for an address is a prompt, not a lock.
  const ready = formOnPlan || documentReady;

  if (closed && decision) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-brand-lg border bg-card px-4 py-3"
      >
        <Check
          className="size-4 shrink-0 text-navy-deep"
          strokeWidth={2.5}
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 text-[14px] leading-snug font-medium">
          {closedHeadline(decision, actions, did ?? [], t)}
        </p>
      </div>
    );
  }

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
          {showSummary ? (
            <p className="text-[14px] leading-relaxed font-medium">{summary}</p>
          ) : null}

          {kind && compose && !formOnPlan ? (
            <ComposeForm
              kind={kind}
              fields={compose.fields}
              onChange={compose.setFields as (next: EmailFields | CalendarFields | DocumentFields) => void}
              disabled={busy}
            />
          ) : !kind && actions.length > 0 ? (
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
              disabled={busy || !ready}
              onClick={() => {
                void (async () => {
                  await compose?.flush();
                  onConfirm();
                })();
              }}
              className="cursor-pointer rounded-full bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmText}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onDecline}
              className="cursor-pointer rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {declineLabel}
            </button>
            {onCorrect && !amending ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setAmending(true)}
                className="cursor-pointer rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                className="cursor-pointer rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
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

export type EmailFields = { to: string; subject: string; body: string };
export type CalendarFields = { title: string; starts: string; timeZone: string; attendees: string };
export type DocumentFields = { title: string; body: string };
export type ComposeFields = EmailFields | CalendarFields | DocumentFields;

function closedHeadline(
  kind: "confirmed" | "declined" | "corrected",
  actions: { label: string; tool?: string }[],
  did: ActOutcome[],
  t: (key: string) => string,
): string {
  if (kind === "confirmed" && actions.some((a) => a.tool === "create_event")) {
    return t("compose.addedToCalendar");
  }
  return settledHeadline(kind, actions, did);
}

function documentConfirmLabel(
  tool: string | undefined,
  t: (key: string) => string,
  fallback: string,
): string {
  if (tool === "create_spreadsheet") return t("compose.createSpreadsheet");
  if (tool === "create_slides") return t("compose.createSlides");
  if (tool === "create_pdf") return t("compose.createPdf");
  if (tool === "create_markdown") return t("compose.createNote");
  if (tool === "create_document") return t("compose.createDocument");
  return fallback;
}

function documentPatch(step: ComposeSource, fields: DocumentFields) {
  return {
    connector: "work_files",
    tool: step.tool || "create_document",
    arguments: {
      ...(step.arguments ?? {}),
      title: fields.title,
      body: fields.body,
    },
  };
}

export function useComposeFields(
  sources: ComposeSource[],
  kind: ComposeKind,
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
    timeZone: argString(step?.arguments, "time_zone") || calendarZone(),
    attendees: argString(step?.arguments, "attendees"),
  };
  const incomingDocument: DocumentFields = {
    title: argString(step?.arguments, "title"),
    body: documentBodyFromArgs(step?.arguments),
  };
  const [email, setEmail] = useState<EmailFields>(incomingEmail);
  const [calendar, setCalendar] = useState<CalendarFields>(incomingCalendar);
  const [document, setDocument] = useState<DocumentFields>(incomingDocument);

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

  useEffect(() => {
    if (kind !== "document") return;
    setDocument((prev) =>
      prev.title === incomingDocument.title && prev.body === incomingDocument.body
        ? prev
        : incomingDocument,
    );
  }, [kind, incomingDocument.title, incomingDocument.body]);

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
              time_zone: calendar.timeZone.trim() || calendarZone(),
              attendees: calendar.attendees,
            },
          }
        : kind === "document" && step
          ? documentPatch(step, document)
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
        : kind === "calendar"
          ? {
              connector: "google_calendar",
              tool: "create_event",
              arguments: {
                title: calendar.title,
                starts_at: fromDatetimeLocal(calendar.starts),
                time_zone: calendar.timeZone.trim() || calendarZone(),
                attendees: calendar.attendees,
              },
            }
          : step
            ? documentPatch(step, document)
            : null;
    if (!next) return;
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
    document.title,
    document.body,
    step?.tool,
    step?.connector,
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
    document.title,
    document.body,
  ]);

  if (!kind || !step) return null;

  if (kind === "email") {
    return { fields: email, setFields: setEmail, flush };
  }
  if (kind === "document") {
    return { fields: document, setFields: setDocument, flush };
  }
  return { fields: calendar, setFields: setCalendar, flush };
}

export function ComposeForm({
  kind,
  fields,
  onChange,
  disabled,
}: {
  kind: Exclude<ComposeKind, null>;
  fields: ComposeFields;
  onChange: (next: ComposeFields) => void;
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

  if (kind === "document") {
    const doc = fields as DocumentFields;
    return (
      <div className="mt-3 space-y-2.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.title")}
          <input
            type="text"
            value={doc.title}
            disabled={disabled}
            onChange={(e) => onChange({ ...doc, title: e.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="block text-[12px] font-medium text-muted-foreground">
          {t("compose.outline")}
          <textarea
            rows={10}
            value={doc.body}
            disabled={disabled}
            onChange={(e) => onChange({ ...doc, body: e.target.value })}
            placeholder={t("compose.outlineHint")}
            className="mt-1 w-full resize-y rounded-brand border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
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
