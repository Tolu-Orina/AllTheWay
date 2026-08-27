import { useState } from "react";
import type { Citation } from "@alltheway/contracts";
import { useT } from "@/app/i18n";

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
 */
export function CitationChip({ citation }: { citation: Citation }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = citation.title || t("citations.passage");

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
        </SheetContent>
      </Sheet>
    </>
  );
}
