import { Link } from "react-router";
import { useT } from "@/app/i18n";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Session } from "@/app/data";
import { relativeTime } from "@/lib/format";

export default function Sessions() {
  const t = useT();
  const { state, reload } = useAsync<Session[]>(() => api.sessions());

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
            {t("nav.sessions")}
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {t("common.everythingYouAndTheCompanionAre")}
          </p>
        </div>
        <Button variant="brand" size="lg" className="shrink-0">
          <Plus />
          New
        </Button>
      </header>

      <Async
        state={state}
        reload={reload}
        isEmpty={(rows) => rows.length === 0}
        empty={
          <EmptyState
            title="No sessions yet"
            body="Start one by describing what you are trying to get done. The companion will ask before it assumes anything."
            action={
              <Button variant="brand" size="lg">
                <Plus />
                {t("common.startYourFirstSession")}
              </Button>
            }
          />
        }
      >
        {(rows) => (
          <ul className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1">
            {rows.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/app/sessions/${s.id}`}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {s.title}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">
                      {relativeTime(s.updatedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">
                    {s.done}/{s.total}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}
