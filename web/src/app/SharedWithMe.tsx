import { useState } from "react";
import { useT } from "@/app/i18n";
import { Bell, BellOff, Users } from "lucide-react";
import { Link } from "react-router";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type SharedArtifact } from "@/app/data";
import { enablePush } from "@/app/push";

/**
 * Work other people shared with you, and the notification switch.
 *
 * ## Why these sit together
 *
 * Both answer "what is coming *to* me". Someone who has just been given access
 * to a colleague's document is exactly the person who wants to hear when it
 * changes, and putting the two side by side means the switch is found by the
 * people it is for rather than by whoever goes looking in settings.
 *
 * ## Permission is asked here, never on load
 *
 * A notification prompt before anyone has seen what the product does is the
 * fastest route to a permanent "Block" — and a blocked permission cannot be
 * re-requested, only undone in browser settings, which nobody does. So it is
 * behind a control the user chose to press.
 */
export function SharedWithMe() {
  const t = useT();
  const { state, reload } = useAsync<SharedArtifact[]>(() => api.sharedWithMe());
  const [push, setPush] = useState<{ on: boolean; note: string | null }>({
    on: false,
    note: null,
  });
  const [busy, setBusy] = useState(false);

  async function turnOnNotifications() {
    setBusy(true);
    const outcome = await enablePush();
    setBusy(false);

    setPush(
      outcome.ok
        ? { on: true, note: "You will hear when something needs a decision." }
        : // Verbatim. "Blocked in your browser settings" and "not configured
          // for this deployment" need different actions from different people.
          { on: false, note: outcome.reason },
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("share.sharedWithYou")}
      </h2>

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.length === 0}
        empty={
          <p className="py-3 text-[12.5px] text-muted-foreground">
            {t("share.nothingYetWhenSomeoneSharesA")}
          </p>
        }
      >
        {(rows) => (
          <ul className="flex flex-col gap-2">
            {rows.map((s) => (
              <li key={s.artifactId} className="rounded-brand border bg-card px-3.5 py-3">
                <Link
                  to={`/app/artifacts/${s.artifactId}?owner=${encodeURIComponent(s.ownerUid)}`}
                  className="text-[13.5px] font-medium underline-offset-2 hover:underline"
                >
                  {s.title}
                </Link>
                <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Users className="size-3.5" aria-hidden="true" />
                  from {s.ownerEmail} · {s.role === "commenter" ? "you can comment" : "view only"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Async>

      <div className="rounded-brand border bg-card px-3.5 py-3">
        <button
          type="button"
          onClick={turnOnNotifications}
          disabled={busy || push.on}
          className="flex items-center gap-1.5 text-[13px] disabled:opacity-60"
        >
          {push.on ? (
            <Bell className="size-4" aria-hidden="true" />
          ) : (
            <BellOff className="size-4" aria-hidden="true" />
          )}
          {push.on ? "Notifications are on" : "Notify me when something needs a decision"}
        </button>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {push.note ??
            "One notification in the morning, and only when something is actually waiting."}
        </p>
      </div>
    </section>
  );
}
