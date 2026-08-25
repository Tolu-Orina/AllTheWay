import { Check, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LogoMark } from "@/components/primitives/logo";
import { cn } from "@/lib/utils";

const STEPS = [
  { label: "Scope the layout", done: true },
  { label: "Draft nav wireframe", done: true },
  { label: "Draft content grid", done: false },
  { label: "Review together", done: false },
];

/**
 * The hero's dominant image: a real slice of the product — the Clarify Gate
 * asking before it acts, and the Plan Panel showing its work. Rendered as live
 * DOM rather than a screenshot so it stays crisp and readable at every size.
 */
export function ProductPanel({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-brand-lg border bg-card shadow-float",
        className,
      )}
      role="img"
      aria-label="AllTheWay asking a clarifying question before drafting, alongside a four-step plan with two steps complete."
    >
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b bg-muted/60 px-4 py-3">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </div>
        <span className="text-[13px] text-muted-foreground">
          Sessions / Grant application draft
        </span>
      </div>

      <div className="space-y-4 p-5">
        {/* the clarify gate */}
        <div className="flex gap-3">
          <LogoMark className="size-7" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="rounded-brand rounded-tl-sm border bg-background px-3.5 py-2.5 text-[14px] leading-relaxed">
              Before I draft this — quick check on scope: desktop-first or
              mobile-first?
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-primary/50 bg-primary/20 px-3 py-1.5 text-[13px] font-medium text-foreground">
                Desktop-first
              </span>
              <span className="rounded-full border bg-background px-3 py-1.5 text-[13px] text-muted-foreground">
                Mobile-first
              </span>
            </div>
          </div>
        </div>

        {/* the plan panel */}
        <div className="rounded-brand border bg-background p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">Plan</span>
            <span className="text-[13px] text-muted-foreground">
              2 of 4 done
            </span>
          </div>

          <ul className="space-y-2.5">
            {STEPS.map((step, i) => (
              <motion.li
                key={step.label}
                className="flex items-center gap-2.5 text-[14px]"
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: 0.5 + i * 0.08,
                  duration: 0.35,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-[18px] shrink-0 place-items-center rounded-[6px] border",
                    step.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card",
                  )}
                >
                  {step.done ? (
                    <Check className="size-3" strokeWidth={3} />
                  ) : null}
                </span>
                <span
                  className={cn(
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.label}
                </span>
              </motion.li>
            ))}
          </ul>
        </div>

        {/* the trace line — the trust story, in the product itself */}
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          Every step above is recorded in your Transparent Trace.
        </div>
      </div>
    </div>
  );
}
