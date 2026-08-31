import type { ReactNode } from "react";
import { Calendar, ChevronRight, Folder, Mail, Sparkles } from "lucide-react";

import { LogoMark } from "@/components/primitives/logo";
import { useT } from "@/app/i18n";
import type { ProposedAction } from "@/app/use-turn";
import { spokenTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One turn in a conversation: you on the right, AllTheWay on the left.
 *
 * The mark sits at 20px so it reads as a speaker, not a header logo.
 * Agent copy sits on the page — no bubble — matching the work-chat layout.
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
        <div className="max-w-[min(36rem,92%)] rounded-brand-lg bg-muted px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-foreground dark:bg-accent">
          {children}
          {live ? <LiveCaret /> : null}
        </div>
        <p className="text-[12px] text-muted-foreground">{meta}</p>
        {footer}
      </article>
    );
  }

  return (
    <article className="flex items-start gap-3">
      <LogoMark className="mt-0.5 size-5 rounded-full" />
      <div className="min-w-0 flex-1">
        {children || live ? (
          <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
            {children}
            {live ? <LiveCaret /> : null}
          </div>
        ) : null}
        <p className={cn("text-[12px] text-muted-foreground", (children || live) && "mt-2")}>
          {meta}
        </p>
        {footer ? <div className="mt-3 flex flex-col gap-2">{footer}</div> : null}
      </div>
    </article>
  );
}

export function ProposedActionCard({ action }: { action: ProposedAction }) {
  const Icon = iconFor(action);
  return (
    <div className="flex items-center gap-3 rounded-brand-lg border bg-card px-4 py-3">
      <Icon className="size-4 shrink-0 text-navy-deep" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{action.label}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
