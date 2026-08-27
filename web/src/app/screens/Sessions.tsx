import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect } from "react";
import { useT } from "@/app/i18n";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Async, EmptyState } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Session } from "@/app/data";
import { useStartWork } from "@/app/use-start-work";
import { relativeTime } from "@/lib/format";

export default function Sessions() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, reload } = useAsync<Session[]>(() => api.sessions());
  const { startWork, starting } = useStartWork();

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    let cancelled = false;
    void (async () => {
      try {
        const { id } = await api.createSession();
        if (!cancelled) navigate(`/app/work/${id}`, { replace: true });
      } catch {
        if (!cancelled) setSearchParams({}, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams, setSearchParams]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-bold tracking-[-0.02em]">
            {t("nav.work")}
          </h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {t("work.listHint")}
          </p>
          <p className="mt-1">
            <Link
              to="/app/you#documents"
              className="text-[13px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("work.bringAFile")}
            </Link>
          </p>
        </div>
        <Button
          variant="brand"
          size="lg"
          className="shrink-0"
          disabled={starting}
          onClick={() => void startWork()}
        >
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
            title={t("work.emptyTitle")}
            body={t("work.emptyBody")}
            action={
              <Button
                variant="brand"
                size="lg"
                disabled={starting}
                onClick={() => void startWork()}
              >
                <Plus />
                {t("work.startFirst")}
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
                  to={`/app/work/${s.id}`}
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
