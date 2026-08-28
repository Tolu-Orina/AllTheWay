import { useT } from "@/app/i18n";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/app/data";
import { useLifeAlerts } from "@/app/life/alerts";

export function LifeTray() {
  const t = useT();
  const { due, refresh } = useLifeAlerts();

  if (due.length === 0) return null;

  async function dismiss(id: string) {
    try {
      await api.dismissReminder(id);
      refresh();
    } catch {
      /* tray is best-effort */
    }
  }

  return (
    <section
      aria-labelledby="tray-heading"
      className="rounded-brand-lg border border-primary/30 bg-card p-4 shadow-e1"
    >
      <div className="flex items-center gap-2">
        <Bell className="size-4" aria-hidden="true" />
        <h2 id="tray-heading" className="text-[16px] font-semibold">
          {t("life.trayHeading")}
        </h2>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {due.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-[14px] leading-snug">
              {row.kind === "leave"
                ? t("life.nextLeave", {
                    title: row.title,
                    minutes: String(
                      Math.max(0, Math.round((Date.parse(row.fireAt) - Date.now()) / 60_000)),
                    ),
                  })
                : row.title}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void dismiss(row.id)}>
              {t("life.dismiss")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
