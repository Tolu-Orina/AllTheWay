import { useState } from "react";
import { useT } from "@/app/i18n";
import { Check, Circle, Ear, FileText, MicOff, Slash } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Commitment, type Meeting } from "@/app/data";
import { cn } from "@/lib/utils";
import { ConnectionQuality } from "@/app/MeetingHealth";
import { MeetingInsights } from "@/app/MeetingInsights";

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
function GlobalSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <label className="flex items-start gap-2.5 rounded-brand border bg-card px-3.5 py-3">
      <input
        type="checkbox"
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
  const [enabled, setEnabled] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setFailure(null);
    setEnabled(next);
    try {
      await api.setMeetingNotes(next);
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

      <GlobalSwitch enabled={enabled} onChange={toggle} />

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
              <MeetingRow key={meeting.id} meeting={meeting} />
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

function MeetingRow({ meeting }: { meeting: Meeting }) {
  const t = useT();
  const [open, setOpen] = useState(false);

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
            meeting.status === "listening" && "bg-primary/10 text-primary",
            meeting.status === "blocked" && "bg-destructive/10 text-destructive",
          )}
        >
          {meeting.status}
        </span>
      </div>

      <ListeningIndicator meeting={meeting} />

      {/*
        Insights, on whichever device this is.

        While screen-sharing, the extension's side panel is visible to everyone
        in the meeting — a phone is the only private surface. Expanded by
        default while the meeting is live, because during it the whole value is
        being glanceable; collapsed afterwards, when it is a record.
      */}
      <details className="mt-2" open={meeting.status === "listening"}>
        <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
          {t("meetings.noticed")}
        </summary>
        <div className="mt-2">
          <MeetingInsights
            meetingId={meeting.id}
            live={meeting.status === "listening"}
          />
        </div>
      </details>

      {/* Quality while it is happening, not a verdict afterwards. "It says
          patchy, I'll take my own notes for this bit" is a recovery that no
          amount of post-hoc labelling can offer. */}
      {meeting.status === "listening" ? (
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
      {meeting.status === "listening" ? (
        <button
          type="button"
          onClick={() => void api.optOutOfMeeting(meeting.id)}
          className="mt-2 flex items-center gap-1.5 text-[12.5px] underline underline-offset-2 text-muted-foreground"
        >
          <Slash className="size-3.5" aria-hidden="true" />
          {t("meetings.stayOut")}
        </button>
      ) : null}
    </li>
  );
}

/**
 * A commitment, awaiting a person.
 *
 * Mobile matters here specifically: nobody edits a transcript on a phone, but
 * approving four commitments on the walk back from a meeting is exactly the
 * right thing to do on one (R2). So this is a full-width tap target with the
 * text readable at a glance, not a row in a table.
 */
export function CommitmentCard({
  commitment,
  onConfirm,
}: {
  commitment: Commitment;
  onConfirm: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

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

      <button
        type="button"
        disabled={busy || commitment.confirmed}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm(commitment.id);
          } finally {
            setBusy(false);
          }
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-brand border px-3 py-2 text-[13px] transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Check className="size-4" aria-hidden="true" />
        {commitment.confirmed ? "Confirmed" : "Yes, make this a task"}
      </button>
    </li>
  );
}
