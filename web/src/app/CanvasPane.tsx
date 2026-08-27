import { useEffect, useState } from "react";
import { useT } from "@/app/i18n";
import { ArrowLeft, FileText, Image as ImageIcon, ListChecks } from "lucide-react";

import { Canvas } from "@/app/Canvas";
import { Async } from "@/app/async";
import { useAsync } from "@/app/use-async";
import { api, type Artifact } from "@/app/data";

/**
 * The "Work" half of the panel: a list of artifacts, or one of them open.
 *
 * A list and a detail in one column rather than two places, because the
 * artifact is the *subject* of the conversation happening beside it — sending
 * someone to another screen to look at it would break the pairing the canvas
 * exists to create.
 *
 * When this is a session's canvas, the first artifact opens itself. Discovering
 * a tab named Work inside a panel named companion is not a product.
 */

const ICONS = {
  doc: FileText,
  summary: FileText,
  checklist: ListChecks,
  image: ImageIcon,
  video: ImageIcon,
} as const;

export function CanvasPane({ sessionId }: { sessionId?: string }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const { state, reload } = useAsync(() => api.artifacts(sessionId), [sessionId ?? ""]);

  useEffect(() => {
    setOpenId(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || state.status !== "ready" || state.data.length === 0) return;
    setOpenId((current) => current ?? state.data[0]!.id);
  }, [sessionId, state]);

  if (openId) {
    return (
      <div className="flex h-full flex-col">
        <button
          type="button"
          onClick={() => {
            setOpenId(null);
            // Re-read on the way back: a correction just changed the list's
            // ordering and version count.
            reload();
          }}
          className="flex items-center gap-1.5 border-b px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          {t("canvas.allWork")}
        </button>
        <div className="min-h-0 flex-1">
          <Canvas artifactId={openId} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <Async
        state={state}
        reload={reload}
        isEmpty={(items) => items.length === 0}
        empty={
          // Names what the space is for rather than apologising for being
          // empty. An empty state that says "nothing here" teaches nothing.
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-[13.5px] font-medium">Nothing made yet</p>
            <p className="max-w-[20rem] text-[12.5px] leading-relaxed text-muted-foreground">
              {t("canvas.anythingItDraftsForYouLands")}
            </p>
          </div>
        }
      >
        {(items) => (
          <ul className="flex flex-col gap-2">
            {items.map((artifact) => (
              <ArtifactRow key={artifact.id} artifact={artifact} onOpen={() => setOpenId(artifact.id)} />
            ))}
          </ul>
        )}
      </Async>
    </div>
  );
}

function ArtifactRow({ artifact, onOpen }: { artifact: Artifact; onOpen: () => void }) {
  const Icon = ICONS[artifact.kind] ?? FileText;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2.5 rounded-brand border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-medium">{artifact.title}</span>
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            {/* Version count is the useful number here: it says how much
                correcting this took, which is the product's own thesis. */}
            {artifact.currentVersion} version{artifact.currentVersion === 1 ? "" : "s"}
          </span>
        </span>
      </button>
    </li>
  );
}
