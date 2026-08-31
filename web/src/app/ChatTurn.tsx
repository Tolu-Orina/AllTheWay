import type { ReactNode } from "react";
import {
  BadgeCheck,
  Calendar,
  Database,
  File,
  FileText,
  Folder,
  Image as ImageIcon,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import type { Citation, ThreadAttachment } from "@alltheway/contracts";

import { Avatar } from "@/app/Avatar";
import { LogoMark } from "@/components/primitives/logo";
import { useT } from "@/app/i18n";
import type { ProposedAction } from "@/app/use-turn";
import { formatFileSize } from "@/lib/work-attach";
import { spokenTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One turn in a conversation: you on the right, AllTheWay on the left.
 *
 * The mark sits at 32px so it reads as a speaker. Agent copy sits in a
 * bordered bubble; user copy in a muted one, with their avatar on the right.
 */
export function ChatTurn({
  side,
  at,
  live,
  children,
  footer,
}: {
  side: "user" | "agent";
  at?: string;
  live?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const who = side === "user" ? t("chat.you") : t("chat.companion");
  const time = spokenTime(at);
  const meta = time ? `${who} · ${time}` : who;

  if (side === "user") {
    return (
      <article className="flex flex-col items-end gap-1.5">
        <div className="flex max-w-[min(40rem,100%)] items-end justify-end gap-2">
          <div className="min-w-0 rounded-brand-lg bg-muted px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground dark:bg-accent">
            {children}
            {live ? <LiveCaret /> : null}
          </div>
          <Avatar size={28} className="mb-0.5" />
        </div>
        {footer ? <div className="flex max-w-[min(40rem,100%)] justify-end">{footer}</div> : null}
        <p className="text-[12px] text-muted-foreground">{meta}</p>
      </article>
    );
  }

  return (
    <article className="flex items-start gap-3">
      <LogoMark className="mt-0.5 size-8 rounded-full" />
      <div className="min-w-0 flex-1">
        {children || live ? (
          <div className="max-w-[min(40rem,100%)] rounded-brand-lg border bg-card px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
            {children}
            {live ? <LiveCaret /> : null}
          </div>
        ) : null}
        {footer ? <div className="mt-3 flex max-w-[min(40rem,100%)] flex-col gap-2">{footer}</div> : null}
        <p className={cn("text-[12px] text-muted-foreground", (children || live || footer) && "mt-2")}>
          {meta}
        </p>
      </div>
    </article>
  );
}

export function FilePills({
  files,
  onRemove,
  align = "end",
}: {
  files: { id: string; name: string; mime: string }[];
  onRemove?: (id: string) => void;
  align?: "start" | "end";
}) {
  const t = useT();
  if (!files.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", align === "end" ? "justify-end" : "justify-start")}>
      {files.map((file) => {
        const Icon = iconForFile(file.mime, file.name);
        return (
          <li
            key={file.id}
            className="inline-flex max-w-48 items-center gap-1.5 rounded-full border bg-card py-1 pr-1.5 pl-2 text-[12px]"
          >
            <span
              className={cn("grid size-5 shrink-0 place-items-center rounded-full", toneForFile(file.mime, file.name))}
              aria-hidden="true"
            >
              <Icon className="size-3" />
            </span>
            <span className="truncate font-medium">{file.name}</span>
            {onRemove ? (
              <button
                type="button"
                aria-label={t("work.removeFile", { name: file.name })}
                onClick={() => onRemove(file.id)}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

type GroundedCard = {
  id: string;
  title: string;
  mime?: string;
  size?: number;
  pages?: number;
  page?: number;
};

export function GroundedIn({
  citations,
  attachments,
}: {
  citations?: Citation[];
  attachments?: ThreadAttachment[];
}) {
  const t = useT();
  const cards = groundedCards(citations, attachments);
  if (!cards.length) return null;

  return (
    <section className="rounded-brand-lg border bg-card px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-foreground uppercase">
        <Database className="size-3.5 text-navy-deep" aria-hidden="true" />
        {t("work.groundedIn")}
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {cards.map((card) => {
          const Icon = iconForFile(card.mime ?? "", card.title);
          return (
            <li key={card.id} className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5">
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg",
                  toneForFile(card.mime ?? "", card.title),
                )}
                aria-hidden="true"
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{card.title}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {groundedMeta(t, card)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <BadgeCheck className="size-3.5" aria-hidden="true" />
        {t("work.indexed")}
      </p>
    </section>
  );
}

function groundedCards(citations?: Citation[], attachments?: ThreadAttachment[]): GroundedCard[] {
  if (citations?.length) {
    const byDoc = new Map<string, GroundedCard>();
    for (const citation of citations) {
      if (citation.kind === "web") continue;
      const id = citation.documentId || citation.chunkId;
      if (!id || byDoc.has(id)) continue;
      byDoc.set(id, {
        id,
        title: citation.title || "Document",
        page: citation.page || undefined,
      });
    }
    if (byDoc.size) return [...byDoc.values()];
  }
  return (attachments ?? []).map((file, i) => ({
    id: file.documentId || file.artifactId || `${file.name}-${i}`,
    title: file.name,
    mime: file.mime,
    size: file.size,
    pages: file.pages,
  }));
}

function groundedMeta(
  t: (key: string, vars?: Record<string, unknown>) => string,
  card: GroundedCard,
): string {
  const kind = kindLabel(t, card.mime ?? "", card.title);
  if (card.pages) return `${kind} · ${t("work.pageCount", { count: card.pages })}`;
  if (card.page) return `${kind} · ${t("citations.page", { page: card.page })}`;
  if (card.size) return `${kind} · ${formatFileSize(card.size)}`;
  return kind;
}

function kindLabel(
  t: (key: string, vars?: Record<string, unknown>) => string,
  mime: string,
  name: string,
): string {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)) {
    return t("work.kindVisual");
  }
  return t("work.kindDocument");
}

function iconForFile(mime: string, name: string) {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)) return ImageIcon;
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return FileText;
  if (mime.startsWith("text/") || /\.(txt|md|markdown)$/i.test(name)) return FileText;
  return File;
}

function toneForFile(mime: string, name: string): string {
  if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)) {
    return "bg-navy-deep/10 text-navy-deep";
  }
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
    return "bg-muted text-navy-deep";
  }
  return "bg-muted text-muted-foreground";
}

export function ProposedActionCard({ action }: { action: ProposedAction }) {
  const Icon = iconFor(action);
  return (
    <div className="flex items-center gap-3 rounded-brand-lg border bg-card px-4 py-3">
      <Icon className="size-4 shrink-0 text-navy-deep" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{action.label}</span>
    </div>
  );
}

function LiveCaret() {
  return (
    <span
      className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-px bg-foreground/50 motion-safe:animate-pulse"
      aria-hidden="true"
    />
  );
}

function iconFor(action: ProposedAction) {
  const key = `${action.connector ?? ""}.${action.tool ?? ""}`;
  if (key.includes("gmail") || /mail|email|draft/i.test(action.label)) return Mail;
  if (key.includes("calendar") || /calendar|event|meet/i.test(action.label)) return Calendar;
  if (key.includes("drive") || /file|folder|drive/i.test(action.label)) return Folder;
  return Sparkles;
}

export function ChatStatus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="status" className={cn("text-[13px] text-muted-foreground", className)}>
      {children}
    </p>
  );
}
