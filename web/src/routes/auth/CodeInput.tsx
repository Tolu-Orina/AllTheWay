import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const LENGTH = 6;

/**
 * Six-box code entry.
 *
 * The boxes are presentation; the value is a single string. Everything people
 * actually do with a code works: typing advances, backspace retreats, arrows
 * move, and pasting the whole code from an email fills every box at once —
 * which is how most people enter these.
 *
 * Each box carries its own label for screen readers, and the group is labelled
 * once, so it is never a row of unnamed inputs.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(LENGTH).slice(0, LENGTH).split("");

  useEffect(() => {
    if (value.length === LENGTH) onComplete?.(value);
    // onComplete is intentionally excluded: firing once per completed value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const setAt = (index: number, digit: string) => {
    const next = value.padEnd(LENGTH).split("");
    next[index] = digit;
    onChange(next.join("").trimEnd());
  };

  return (
    <div
      role="group"
      aria-label="Six digit verification code"
      className="flex justify-between gap-2"
    >
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digits[i]?.trim() ?? ""}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          onChange={(e) => {
            const digit = e.target.value.replace(/\D/g, "").slice(-1);
            if (!digit) return;
            setAt(i, digit);
            refs.current[Math.min(i + 1, LENGTH - 1)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (digits[i]?.trim()) setAt(i, " ");
              else if (i > 0) {
                setAt(i - 1, " ");
                refs.current[i - 1]?.focus();
              }
            }
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < LENGTH - 1)
              refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData
              .getData("text")
              .replace(/\D/g, "")
              .slice(0, LENGTH);
            if (!pasted) return;
            onChange(pasted);
            refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
          }}
          className={cn(
            "h-14 w-full min-w-0 rounded-brand border bg-background text-center text-[20px] font-semibold tabular-nums outline-none",
            "focus-visible:border-ring",
            invalid && "border-destructive",
          )}
        />
      ))}
    </div>
  );
}
