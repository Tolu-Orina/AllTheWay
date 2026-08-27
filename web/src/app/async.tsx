import type { ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AsyncState } from "@/app/use-async";
import { useT } from "@/app/i18n";

/**
 * Errors say what happened and offer the next action. They never blame the
 * user and never surface a stack trace.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      className="rounded-brand-lg border border-destructive/30 bg-card p-6 text-center"
    >
      <TriangleAlert
        className="mx-auto size-5 text-destructive"
        aria-hidden="true"
      />
      <h2 className="mt-3 text-[15px] font-semibold">{t("common.couldNotLoad")}</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {message} {t("common.workSafe")}
      </p>
      <Button variant="outline" size="lg" className="mt-4" onClick={onRetry}>
        <RotateCw />
        {t("common.retry")}
      </Button>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-brand-lg border border-dashed bg-card p-10 text-center">
      <h2 className="text-[16px] font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Skeletons mirror the real row, so nothing jumps when data lands. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading"
      className="divide-y overflow-hidden rounded-brand-lg border bg-card shadow-e1"
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

export function Async<T>({
  state,
  reload,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  state: AsyncState<T>;
  reload: () => void;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <>{skeleton ?? <SkeletonList />}</>;
  if (state.status === "error")
    return <ErrorState message={state.message} onRetry={reload} />;
  if (isEmpty?.(state.data) && empty) return <>{empty}</>;
  return <>{children(state.data)}</>;
}
