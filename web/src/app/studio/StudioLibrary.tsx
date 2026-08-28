import { Clapperboard, Image as ImageIcon, Plus } from "lucide-react";

import { useT } from "@/app/i18n";
import { StudioThumb } from "@/app/studio/StudioThumb";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/app/data";

export type LibraryFilter = "all" | "image" | "video";

export function StudioLibrary({
  items,
  filter,
  onFilter,
  selectedId,
  onSelect,
  onNew,
}: {
  items: Artifact[];
  filter: LibraryFilter;
  onFilter: (next: LibraryFilter) => void;
  selectedId: string | null;
  onSelect: (item: Artifact) => void;
  onNew: () => void;
}) {
  const t = useT();
  const visible = items.filter((item) => filter === "all" || item.kind === filter);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[220px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {t("studio.library")}
        </h2>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-brand px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t("studio.newPiece")}
        </button>
      </div>

      <div role="tablist" aria-label={t("studio.library")} className="flex gap-1">
        {(["all", "image", "video"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => onFilter(value)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[12px] transition-colors",
              filter === value
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "all" ? t("studio.filterAll") : value === "image" ? t("studio.image") : t("studio.video")}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-brand-lg border border-dashed px-3 py-8 text-center lg:min-h-[12rem]">
          {filter === "video" ? (
            <Clapperboard className="size-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("studio.libraryEmpty")}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-4 gap-2 overflow-x-auto pb-1 sm:grid-cols-6 lg:grid-cols-2 lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto">
          {visible.map((item) => (
            <li key={item.id} className="min-w-[4.5rem]">
              <StudioThumb
                artifact={item}
                selected={item.id === selectedId}
                onSelect={() => onSelect(item)}
                label={item.title || t("studio.title")}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
