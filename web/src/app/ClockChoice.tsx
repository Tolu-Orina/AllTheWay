import { useEffect, useState } from "react";

import { api, type Clock } from "@/app/data";
import { calendarZone, deviceTimeZone, ianaZones, rememberClock } from "@/app/clock";
import { useT } from "@/app/i18n";

/**
 * Time zone they want "now" and "today" to mean.
 *
 * This is IANA, not a map pin. "Use this device" is the usual choice.
 * Picking a zone from the list is an override they set — it pins both
 * "what time is it" and new events until they switch back.
 */
export function ClockChoice() {
  const t = useT();
  const [clock, setClock] = useState<Clock | null>(() =>
    peekFromCache(deviceTimeZone()),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .clock()
      .then((next) => {
        if (cancelled) return;
        rememberClock(next);
        setClock(next);
      })
      .catch(() => {
        /* keep the device fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (source: "device" | "override", timeZone: string) => {
    if (!timeZone || busy) return;
    setBusy(true);
    try {
      const next = await api.setClock({ timeZone, source });
      rememberClock(next);
      setClock(next);
    } catch {
      /* leave the previous choice showing */
    } finally {
      setBusy(false);
    }
  };

  const zone = clock?.timeZone || calendarZone();
  const sourceKey =
    clock?.source === "override"
      ? "clock.sourceOverride"
      : clock?.source === "calendar"
        ? "clock.sourceCalendar"
        : "clock.sourceDevice";

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
        {t("clock.heading")}
      </h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{t("clock.hint")}</p>
      <p className="text-[13.5px]">
        {t("clock.current", { zone })} · {t(sourceKey)}
      </p>
      {clock?.differ ? (
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          {t("clock.differ", { calendar: clock.calendarTimeZone })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={clock?.source !== "override"}
          onClick={() => void save("device", deviceTimeZone() || zone)}
          className={
            clock?.source !== "override"
              ? "rounded-brand border border-primary bg-primary/10 px-3 py-1.5 text-[13px]"
              : "rounded-brand border px-3 py-1.5 text-[13px] transition-colors hover:bg-muted"
          }
        >
          {t("clock.useDevice")}
        </button>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">{t("clock.overrideLabel")}</span>
          <select
            value={zone}
            disabled={busy}
            onChange={(event) => void save("override", event.target.value)}
            className="rounded-brand border bg-background px-2 py-1.5 text-[13px]"
          >
            {ianaZones().map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function peekFromCache(device: string): Clock | null {
  if (!device) return null;
  return {
    timeZone: device,
    calendarTimeZone: device,
    deviceTimeZone: device,
    source: "device",
    differ: false,
  };
}
