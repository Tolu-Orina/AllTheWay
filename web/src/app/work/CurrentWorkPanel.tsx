import { Link } from "react-router";
import { FileText, Plus } from "lucide-react";

import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { officeKindLabel } from "@alltheway/contracts";
import { api, type Artifact, type Session } from "@/app/data";
import { useT } from "@/app/i18n";
import { COMPANION_SESSION_ID } from "@/app/work-id";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const STUDIO_SESSION_ID = "studio";

function isListedWork(session: Session): boolean {
  return session.surface !== "companion" && session.id !== COMPANION_SESSION_ID && session.id !== STUDIO_SESSION_ID;
}

/**
 * The 30% rail: previous work chats, and artifacts for the open session.
 */
export function CurrentWorkPanel({
  sessionId,
  artifactTick,
  onOpenArtifact,
}: {
  sessionId?: string;
  artifactTick: number;
  onOpenArtifact: (id: string) => void;
}) {
  const t = useT();
  const sessions = useAsync(() => api.sessions());
  const artifacts = useAsync(
    () => (sessionId ? api.artifacts(sessionId) : Promise.resolve([])),
    [sessionId ?? "", artifactTick],
  );

  const listed =
    sessions.state.status === "ready" ? sessions.state.data.filter(isListedWork) : [];

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-[30%] lg:shrink-0">
      <section className="rounded-brand-lg border bg-card p-4 shadow-e1">
        <header className="mb-3">
          <h2 className="text-[14px] font-semibold">{t("work.previousChats")}</h2>
        </header>
        <Async
          state={sessions.state}
          reload={sessions.reload}
          isEmpty={(rows) => rows.filter(isListedWork).length === 0}
          empty={
            <p className="py-4 text-center text-[13px] text-muted-foreground">
              {t("work.noPrevious")}
            </p>
          }
        >
          {() => (
            <ul className="flex flex-col gap-1">
              {listed.map((s) => {
                const active = s.id === sessionId;
                return (
                  <li key={s.id}>
                    <Link
                      to={`/app/work/${s.id}`}
                      className={cn(
                        "block rounded-brand px-3 py-2.5 transition-colors",
                        active
                          ? "bg-primary/8 ring-1 ring-primary/20"
                          : "hover:bg-muted/70",
                      )}
                    >
                      <span className="block truncate text-[13.5px] font-medium">{s.title}</span>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {active ? t("work.active") : relativeTime(s.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Async>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-brand-lg border bg-card p-4 shadow-e1">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">{t("work.artifacts")}</h2>
          <span className="text-[12px] text-muted-foreground">
            {t("work.itemCount", {
              count: artifacts.state.status === "ready" ? artifacts.state.data.length : 0,
            })}
          </span>
        </header>
        <Async
          state={artifacts.state}
          reload={artifacts.reload}
          isEmpty={(items) => items.length === 0}
          empty={
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
              <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-[13.5px] font-medium">{t("work.artifactsEmpty")}</p>
              <p className="max-w-[16rem] text-[12.5px] leading-relaxed text-muted-foreground">
                {t("work.artifactsEmptyHint")}
              </p>
            </div>
          }
        >
          {(items) => (
            <div className="flex flex-col gap-2">
              {items.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  onOpen={() => onOpenArtifact(artifact.id)}
                />
              ))}
            </div>
          )}
        </Async>
        {sessionId ? (
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const created = await api.createArtifact({
                  kind: "doc",
                  title: t("work.untitledNote"),
                  sessionId,
                  content: "",
                  mimeType: "text/markdown",
                });
                artifacts.reload();
                onOpenArtifact(created.id);
              })();
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-brand border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t("work.createEmpty")}
          </button>
        ) : null}
      </section>
    </aside>
  );
}

function ArtifactCard({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const t = useT();

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-brand border bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40"
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {labelFor(artifact, t)}
        </span>
        <span className="mt-0.5 block truncate text-[13.5px] font-medium">{artifact.title}</span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {t("work.versionsLabel", { n: artifact.currentVersion })}
        </span>
      </span>
    </button>
  );
}

function labelFor(artifact: Artifact, t: (key: string) => string): string {
  const kind = officeKindLabel(artifact.mimeType ?? "");
  if (kind === "slides") return t("work.kindSlides");
  if (kind === "sheet") return t("work.kindSheet");
  if (kind === "word") return t("work.kindWord");
  if (artifact.kind === "image" || kind === "image") return t("work.kindImage");
  if (artifact.kind === "video" || kind === "video") return t("work.kindVideo");
  if (artifact.kind === "checklist") return t("work.kindChecklist");
  if (artifact.kind === "summary") return t("work.kindSummary");
  return t("work.kindDocument");
}
