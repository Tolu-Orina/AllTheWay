import type { RefObject } from "react";
import { Bold, Heading2, Italic, Link, List, Quote } from "lucide-react";

import { useT } from "@/app/i18n";
import { cn } from "@/lib/utils";

/**
 * Markdown marks on a textarea: wrap the selection, keep the caret.
 *
 * The canvas stores markdown, not HTML. These buttons write the same marks
 * Preview already knows how to render, so edit and preview cannot drift.
 */

export function applyWrap(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  empty = "text",
): { next: string; start: number; end: number } {
  const selected = value.slice(start, end) || empty;
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    next,
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

export function applyLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
): { next: string; start: number; end: number } {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nl = value.indexOf("\n", end);
  const lineEnd = nl === -1 ? value.length : nl;
  const block = value.slice(lineStart, lineEnd);
  const prefixed = block
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
    .join("\n");
  return {
    next: value.slice(0, lineStart) + prefixed + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + prefixed.length,
  };
}

const ACTIONS = [
  { key: "bold", icon: Bold, wrap: ["**", "**"] as const },
  { key: "italic", icon: Italic, wrap: ["*", "*"] as const },
  { key: "heading", icon: Heading2, prefix: "## " },
  { key: "list", icon: List, prefix: "- " },
  { key: "quote", icon: Quote, prefix: "> " },
  { key: "link", icon: Link, wrap: ["[", "](https://)"] as const, empty: "link" },
] as const;

export function FormatToolbar({
  value,
  onChange,
  textarea,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  textarea: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}) {
  const t = useT();

  function apply(next: string, start: number, end: number) {
    onChange(next);
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  }

  return (
    <div
      role="toolbar"
      aria-label={t("canvas.format")}
      className="flex items-center gap-0.5"
      onMouseDown={(e) => e.preventDefault()}
    >
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.key}
            type="button"
            disabled={disabled}
            title={t(`canvas.${action.key}`)}
            aria-label={t(`canvas.${action.key}`)}
            onClick={() => {
              const el = textarea.current;
              const start = el?.selectionStart ?? 0;
              const end = el?.selectionEnd ?? 0;
              const result =
                "prefix" in action
                  ? applyLinePrefix(value, start, end, action.prefix)
                  : applyWrap(
                      value,
                      start,
                      end,
                      action.wrap[0],
                      action.wrap[1],
                      "empty" in action ? action.empty : "text",
                    );
              apply(result.next, result.start, result.end);
            }}
            className={cn(
              "grid size-8 shrink-0 cursor-pointer place-items-center rounded-brand text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
