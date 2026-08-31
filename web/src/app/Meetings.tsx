import { useState } from "react";
import { useT } from "@/app/i18n";
import { Check, Circle, Ear, FileText, MicOff, Slash } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Commitment, type Meeting } from "@/app/data";
import { cn } from "@/lib/utils";
import { ConfirmGate } from "@/app/ConfirmGate";
import { useCompanionThread } from "@/app/companion-thread";
import { ConnectionQuality, DurationNotice } from "@/app/MeetingHealth";
import { MeetingInsights } from "@/app/MeetingInsights";
import { SendMeetBot } from "@/app/SendMeetBot";

/**
 * Meetings, and what the agent could and could not do in them.
 *
 * ## The tier is stated, always
 *
 * A meeting served by Tier 1 looks, to a user, exactly like one served by
 * Tier 2 that produced few notes — unless the product says which happened. It
 * says so on every meeting, with the refusal reason verbatim, because "there
 * were no live notes and here is why" is answerable and "the notes seem thin"
 * is not.
 *
 * ## It listens; it does not speak
 *
 * FR-C4. The Meet Media API is receive-only, and nothing here may suggest
 * otherwise — a user who believes the agent can speak will eventually rely on
 * it to say something in a room full of people. The wording is "listened",
 * never "joined the conversation", and the indicator is explicitly passive.
 *
 * ## Commitments are proposals
 *
 * FR-C2. A detected commitment is an inference stacked on speech recognition
 * and best-effort speaker attribution — each wrong sometimes. It renders as
 * something to approve, never as something done, and approving it is what
 * sends it through the autonomy floor.
 */

const TIER_LABEL: Record<Meeting["tier"], string> = {
  2: "meetings.listenedLive",
  1: "meetings.readTranscript",
  0: "meetings.noNotes",
};

/**
 * Local capture is not a tier failure and must not read as one.
 *
 * Tier 0 means nothing could serve the meeting. Capturing it yourself means you
 * served it — showing "No notes" for that would report a failure that did not
 * happen, on a meeting that has a full record.
 */
function describeTier(meeting: Meeting, t: (key: string) => string): string {
  // Takes the translator rather than reading a module-level map: these are
  // resolved per render, so switching language re-labels existing rows.
  return t(meeting.capturedLocally ? "meetings.listenedLocally" : TIER_LABEL[meeting.tier]);
}

/**
 * The global off switch (FR-C3).
 *
 * Deliberately at the top of the section rather than buried in a settings page.
 * It is the control a person reaches for when they are uncomfortable, and a
 * control you have to go looking for while uncomfortable is a control that
 * does not exist.
 *
 * It is also the honest default: off until switched on. This component says so
 * rather than showing an unchecked box and letting the user infer it.
 */
function GlobalSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <label className="flex items-start gap-2.5 rounded-brand border bg-card px-3.5 py-3">
      <input
        type="checkbox"
        disabled={disabled}
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0"
      />
      <span className="text-[13px] leading-relaxed">
        {t("meetings.enable")}
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {t("meetings.enableHint")}
        </span>
      </span>
    </label>
  );
}

export function Meetings() {
  const t = useT();
  const { state, reload } = useAsync<Meeting[]>(() => api.meetings());
  const { state: settings, reload: reloadSettings } = useAsync(() => api.meetingSettings());
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const on = enabled ?? (settings.status === "ready" ? settings.data.enabled : false);

  async function toggle(next: boolean) {
    setFailure(null);
    setEnabled(next);
    try {
      await api.setMeetingNotes(next);
      reloadSettings();
    } catch {
      // Put back. A consent switch that looks changed but was not saved is the
      // worst possible failure for this particular control.
      setEnabled(!next);
      setFailure(t("common.saveFailed"));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("meetings.heading")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {t("meetings.intro")}
      </p>
      <p className="text-[12.5px] text-muted-foreground">{t("meetings.sendBotHint")}</p>

      <GlobalSwitch
        enabled={on}
        onChange={toggle}
        disabled={settings.status === "loading" && enabled === null}
      />

      {settings.status === "error" ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {settings.message}{" "}
          <button type="button" className="underline underline-offset-2" onClick={reloadSettings}>
            {t("common.retry")}
          </button>
        </p>
      ) : null}

      {failure ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {failure}
        </p>
      ) : null}

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.length === 0}
        empty={
          <p className="py-4 text-[12.5px] text-muted-foreground">
            {t("meetings.none")}
          </p>
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} onChanged={reload} />
            ))}
          </ul>
        )}
      </Async>
    </section>
  );
}

/**
 * The persistent listening indicator (FR-C3).
 *
 * Ours, in addition to Meet's own participant dialog — a notice shown once when
 * the agent joins is not a notice for the fifty minutes afterwards, and the
 * person who joined late never saw it at all.
 */
export function ListeningIndicator({ meeting }: { meeting: Meeting }) {
  const t = useT();
  if (meeting.status !== "listening") return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-brand border border-primary/40 bg-primary/5 px-3 py-2 text-[12.5px]"
    >
      <Circle
        className="size-2 shrink-0 fill-current text-primary motion-safe:animate-pulse"
        aria-hidden="true"
      />
      {t("meetings.listening")}
    </p>
  );
}

function MeetingRow({
  meeting,
  onChanged,
}: {
  meeting: Meeting;
  onChanged: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const live = meeting.status === "listening" && !meeting.optedOut;
  const duration = meeting.duration;

  async function stayOut() {
    setRowError(null);
    try {
      await api.optOutOfMeeting(meeting.id);
      onChanged();
    } catch {
      setRowError(t("common.saveFailed"));
    }
  }

  async function extend(minutes: number) {
    setRowError(null);
    try {
      await api.extendMeeting(meeting.id, minutes);
      onChanged();
    } catch {
      setRowError(t("common.saveFailed"));
    }
  }

  return (
    <li className="rounded-brand border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium">
            {meeting.spaceName || "Meeting"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {meeting.tier === 2 ? (
              <Ear className="size-3.5" aria-hidden="true" />
            ) : meeting.tier === 1 ? (
              <FileText className="size-3.5" aria-hidden="true" />
            ) : (
              <MicOff className="size-3.5" aria-hidden="true" />
            )}
            {describeTier(meeting, t)}
          </p>

          {/*
            The verbatim refusal, shown rather than summarised. It comes from a
            preview programme whose refusal set we do not control, and a user
            who can read "a participant is not enrolled" can do something about
            it; one who reads "unavailable" cannot.
          */}
          {meeting.tier !== 2 && !meeting.capturedLocally && meeting.tierReason ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-[12px] underline underline-offset-2 text-muted-foreground"
            >
              {open ? t("meetings.hideWhy") : t("meetings.whyNoLiveNotes")}
            </button>
          ) : null}

          {open ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
              {meeting.tierReason}
            </p>
          ) : null}
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px]",
            live && "bg-primary/10 text-primary",
            (meeting.status === "blocked" || meeting.optedOut) &&
              "bg-destructive/10 text-destructive",
          )}
        >
          {meeting.optedOut ? t("meetings.stayedOut") : meeting.status}
        </span>
      </div>

      {live ? <ListeningIndicator meeting={meeting} /> : null}

      {live && duration && (duration.warn || duration.stop) ? (
        <div className="mt-2">
          <DurationNotice
            minutesRemaining={duration.minutesRemaining}
            warn={duration.warn}
            stopped={duration.stop}
            onExtend={(minutes) => void extend(minutes)}
          />
        </div>
      ) : null}

      {/*
        Insights, on whichever device this is.

        While screen-sharing, the extension's side panel is visible to everyone
        in the meeting — a phone is the only private surface. Expanded by
        default while the meeting is live, because during it the whole value is
        being glanceable; collapsed afterwards, when it is a record.
      */}
      <details className="mt-2" open={live}>
        <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
          {t("meetings.noticed")}
        </summary>
        <div className="mt-2">
          <MeetingInsights meetingId={meeting.id} live={live} />
        </div>
      </details>

      <MeetingCommitments meetingId={meeting.id} />

      {meetUrlFor(meeting) ? <SendMeetBot meetUrl={meetUrlFor(meeting)} /> : null}

      {canOverlaySpeakers(meeting) ? (
        <OverlaySpeakers meeting={meeting} />
      ) : null}

      {meeting.bot ? <BotStatus bot={meeting.bot} /> : null}

      {/* Quality while it is happening, not a verdict afterwards. "It says

      {/* Quality while it is happening, not a verdict afterwards. "It says
          patchy, I'll take my own notes for this bit" is a recovery that no
          amount of post-hoc labelling can offer. */}
      {live ? (
        <ConnectionQuality
          sample={
            meeting.health
              ? {
                  packetLoss: meeting.health.packetLoss,
                  jitter: meeting.health.jitter,
                  reconnects: meeting.health.reconnects,
                }
              : null
          }
        />
      ) : null}

      {/*
        The per-meeting opt-out. The common case is not "never" but "not this
        one" — the standup is fine, the difficult conversation is not — and
        forcing that choice to be all-or-nothing means people choose nothing.
      */}
      {live ? (
        <button
          type="button"
          onClick={() => void stayOut()}
          className="mt-2 flex items-center gap-1.5 text-[12.5px] underline underline-offset-2 text-muted-foreground"
        >
          <Slash className="size-3.5" aria-hidden="true" />
          {t("meetings.stayOut")}
        </button>
      ) : null}

      {rowError ? (
        <p role="alert" className="mt-2 text-[12.5px] text-destructive">
          {rowError}
        </p>
      ) : null}
    </li>
  );
}

function MeetingCommitments({ meetingId }: { meetingId: string }) {
  const t = useT();
  const { state, reload } = useAsync(() => api.commitments(meetingId), [meetingId]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  if (state.status === "loading") return null;
  if (state.status === "error") {
    return (
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        {state.message}{" "}
        <button type="button" className="underline underline-offset-2" onClick={reload}>
          {t("common.retry")}
        </button>
      </p>
    );
  }

  const visible = state.data.filter((c) => !dismissed.includes(c.id));
  if (visible.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {visible.map((commitment) => (
        <CommitmentCard
          key={commitment.id}
          commitment={commitment}
          onConfirm={async (id) => {
            await api.confirmCommitment(meetingId, id);
            reload();
          }}
          onDecline={() => setDismissed((prev) => [...prev, commitment.id])}
        />
      ))}
    </ul>
  );
}

/**
 * A commitment, awaiting a person.
 *
 * Mobile matters here specifically: nobody edits a transcript on a phone, but
 * approving four commitments on the walk back from a meeting is exactly the
 * right thing to do on one (R2). So this is a full-width tap target with the
 * text readable at a glance, not a row in a table.
 *
 * Confirm goes through ConfirmGate, the same stop as Watchers and session Yes.
 * It records approval. It does not send mail or create a calendar event —
 * carrying that out is a later action through the same floor.
 */
export function CommitmentCard({
  commitment,
  onConfirm,
  onDecline,
}: {
  commitment: Commitment;
  onConfirm: (id: string) => Promise<void>;
  onDecline?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const who =
    commitment.speakerLabel === "Unattributed" ? "Someone" : commitment.speakerLabel;

  return (
    <li className="flex flex-col gap-2 rounded-brand border bg-card px-3.5 py-3">
      <p className="text-[13.5px] leading-relaxed">
        {/*
          Phrased as an inference, never as a fact. "Ada will send the contract"
          reads as settled; "may have committed to" reads as what it is — a
          guess from a transcript, waiting for a human.
        */}
        <span className="text-muted-foreground">{who} may have committed to:</span>{" "}
        “{commitment.text}”
      </p>
      <p className="text-[12px] text-muted-foreground">
        {t("meetings.nothingHasBeenDoneAboutThis")}
      </p>

      {commitment.confirmed ? (
        <p className="flex items-center gap-1.5 text-[13px]">
          <Check className="size-4" aria-hidden="true" />
          {t("meetings.confirmed")}
        </p>
      ) : (
        <ConfirmGate
          summary={t("meetings.confirmSummary")}
          actions={[
            {
              label: t("meetings.confirmAction"),
              reason: t("meetings.confirmReason"),
            },
          ]}
          confirmLabel={busy ? t("meetings.confirming") : t("meetings.confirm")}
          declineLabel={t("meetings.notThis")}
          busy={busy}
          status={status}
          onConfirm={() => {
            setBusy(true);
            setStatus(null);
            void onConfirm(commitment.id)
              .catch((err: unknown) => {
                setStatus(err instanceof Error ? err.message : t("common.saveFailed"));
              })
              .finally(() => setBusy(false));
          }}
          onDecline={() => onDecline?.()}
        />
      )}
      <PutOnCalendar text={commitment.text} />
    </li>
  );
}

function meetUrlFor(meeting: Meeting): string {
  if (meeting.bot?.meetUrl) return meeting.bot.meetUrl;
  const id = meeting.conferenceId;
  if (id && !id.includes("/") && !id.startsWith("tab-") && /^[a-z0-9][a-z0-9-]{2,}$/i.test(id)) {
    return `https://meet.google.com/${id}`;
  }
  return "";
}

function canOverlaySpeakers(meeting: Meeting): boolean {
  const id = meeting.conferenceId;
  return (
    meeting.capturedLocally &&
    Boolean(id) &&
    !id.includes("/") &&
    !id.startsWith("tab-") &&
    /^[a-z0-9][a-z0-9-]{2,}$/i.test(id)
  );
}

function OverlaySpeakers({ meeting }: { meeting: Meeting }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNote(null);
          void api
            .overlayMeetingSpeakers(meeting.id)
            .then((result) => {
              setNote(
                result.overlaid
                  ? t("meetings.overlayDone", { count: result.overlaid })
                  : t("meetings.overlayNone"),
              );
            })
            .catch(() => setNote(t("common.saveFailed")))
            .finally(() => setBusy(false));
        }}
        className="text-[12.5px] underline underline-offset-2 text-muted-foreground disabled:opacity-50"
      >
        {t("meetings.overlaySpeakers")}
      </button>
      {note ? <p className="mt-1 text-[12px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function BotStatus({ bot }: { bot: NonNullable<Meeting["bot"]> }) {
  const t = useT();
  if (bot.status === "vendor_pending") {
    return <p className="mt-2 text-[12.5px] text-muted-foreground">{t("meetings.botVendorPending")}</p>;
  }
  if (bot.status === "knocking") {
    return <p className="mt-2 text-[12.5px]">{t("meetings.knocking")}</p>;
  }
  if (bot.status === "not_admitted") {
    return <p className="mt-2 text-[12.5px] text-muted-foreground">{t("meetings.notAdmitted")}</p>;
  }
  return null;
}

/**
 * Approving a commitment records it. Putting it on the calendar is a plan,
 * because that is a different action through the same confirm floor.
 */
function PutOnCalendar({ text }: { text: string }) {
  const t = useT();
  const { send, working } = useCompanionThread();
  return (
    <button
      type="button"
      disabled={working}
      onClick={() => send(`Put this on my calendar: ${text}`)}
      className="self-start text-[13px] text-muted-foreground underline underline-offset-2 disabled:opacity-50"
    >
      {t("meetings.putOnCalendar")}
    </button>
  );
}
