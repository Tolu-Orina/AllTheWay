import { useState } from "react";
import type { Citation } from "@alltheway/contracts";
import { useT } from "@/app/i18n";

import { api } from "@/app/data";
import { useCompanionThread } from "@/app/companion-thread";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * A grounded claim, checkable.
 *
 * Opens the passage that was already in the turn event — the same text that
 * was in the prompt (FR-D2). It does not fetch, and it does not send a uid.
 * A chip that re-queried would be a second path, and a path that can open
 * another user's chunk.
 *
 * Explain-again and a missed check are the only writers of the struggle
 * model. Opening this sheet does not write anything.
 */
export function CitationChip({
  citation,
  onExplain,
}: {
  citation: Citation;
  onExplain?: (text: string) => void;
}) {
  const t = useT();
  const companion = useCompanionThread();
  const explain = onExplain ?? companion.send;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const label = citation.title || t("citations.passage");
  const webUrl = citation.url.startsWith("http") ? citation.url : "";

  const remember = async (kind: "reask" | "miss" | "hit"): Promise<boolean> => {
    if (!citation.documentId) return false;
    try {
      if (kind === "reask") await api.conceptReask(citation.documentId, label);
      if (kind === "miss") await api.conceptMiss(citation.documentId, label);
      if (kind === "hit") await api.conceptHit(citation.documentId, label);
      return true;
    } catch {
      setStatus(t("memory.couldNotRecord"));
      return false;
    }
  };

  if (webUrl) {
    return (
      <a
        href={webUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("citations.openWeb", { title: label })}
        className="rounded-full border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {label}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("citations.open", { title: label })}
        onClick={() => setOpen(true)}
        className="rounded-full border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        {label}
        {citation.page ? ` · ${t("citations.page", { page: citation.page })}` : ""}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="gap-3 p-4">
          <SheetHeader className="p-0">
            <SheetTitle>{label}</SheetTitle>
            {citation.page ? (
              <SheetDescription>{t("citations.page", { page: citation.page })}</SheetDescription>
            ) : null}
          </SheetHeader>
          <p className="max-h-[min(24rem,50dvh)] overflow-y-auto text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {citation.text}
          </p>
          {citation.documentId ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void remember("reask").then((ok) => {
                    if (!ok) return;
                    setOpen(false);
                    explain(
                      `Explain ${label} again, differently. I did not follow the last explanation.`,
                    );
                  });
                }}
                className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
              >
                {t("memory.explainAgain")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void remember("hit");
                  setStatus(t("memory.recordedLanded"));
                }}
                className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
              >
                {t("memory.thatLanded")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void remember("miss");
                  setStatus(t("memory.recordedMiss"));
                }}
                className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
              >
                {t("memory.didNotGetIt")}
              </button>
            </div>
          ) : null}
          {status ? (
            <p role="status" className="text-[12.5px] text-muted-foreground">
              {status}
            </p>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
