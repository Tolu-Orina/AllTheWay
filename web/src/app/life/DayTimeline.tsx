import { useMemo } from "react";
import { Link } from "react-router";
import { useT } from "@/app/i18n";
import type { Day, DayItem, Hat } from "@alltheway/contracts";

import { cn } from "@/lib/utils";

const HATS: Array<Hat | "all"> = ["all", "work", "home", "church"];

function wallTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function DayTimeline({
  day,
  hat,
  onHat,
}: {
  day: Day;
  hat: Hat | "all";
  onHat: (hat: Hat | "all") => void;
}) {
  const t = useT();
  const hours = useMemo(
    () => (hat === "all" ? day.hours : day.hours.filter((row) => row.hat === hat)),
    [day.hours, hat],
  );

  return (
    <section aria-labelledby="day-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="day-heading" className="text-[16px] font-semibold">
          {t("life.dayHeading")}
        </h2>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("life.dayHeading")}>
          {HATS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={hat === value}
              onClick={() => onHat(value)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                hat === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`life.hat${value[0]!.toUpperCase()}${value.slice(1)}`)}
            </button>
          ))}
        </div>
      </div>

      {day.calendar === "missing" && day.hours.length === 0 ? (
        <p className="rounded-brand-lg border bg-card px-4 py-4 text-[13.5px] leading-relaxed text-muted-foreground shadow-e1">
          {t("life.connectCalendar")}{" "}
          <Link to="/app/you" className="underline underline-offset-2">
            {t("life.openYou")}
          </Link>
        </p>
      ) : hours.length === 0 ? (
        <p className="rounded-brand-lg border bg-card px-4 py-4 text-[13.5px] text-muted-foreground shadow-e1">
          {t("life.dayEmpty")}
        </p>
      ) : (
        <ol className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1">
          {hours.map((row) => (
            <DayRow key={row.id} item={row} />
          ))}
        </ol>
      )}
    </section>
  );
}

function DayRow({ item }: { item: DayItem }) {
  const t = useT();
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="w-16 shrink-0 text-[13px] text-muted-foreground tabular-nums">
        {wallTime(item.startsAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted-foreground">
          <span>{t(`life.hat${item.hat[0]!.toUpperCase()}${item.hat.slice(1)}`)}</span>
          {item.personName ? <span>{item.personName}</span> : null}
          {item.placeLabel ? <span>{item.placeLabel}</span> : null}
          {item.leaveAt ? <span>{t("life.leaveAt", { time: wallTime(item.leaveAt) })}</span> : null}
        </span>
      </span>
    </li>
  );
}
