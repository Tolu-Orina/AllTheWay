import { motion, useReducedMotion } from "motion/react";
import {
  Calendar,
  Check,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Mail,
  Presentation,
  Video,
} from "lucide-react";
import type { PlanStep } from "@alltheway/contracts";

import { ACTION_LABEL, describeCall, isFetchedRead, isSevere } from "@/app/plan-copy";
import { cn } from "@/lib/utils";

/**
 * The plan, as a stack of cards.
 *
 * A checklist of labels hid the call: "Draft an email to Ana" looked the same
 * as a thought. Each card says what will actually happen, so a person can
 * refuse a step they can see, not a summary they have to decode.
 *
 * Stacked, not listed. Each card sits slightly on the one above it. Later
 * steps are in front because that is the order the work will run.
 */

const ICONS = {
  google_calendar: Calendar,
  google_gmail: Mail,
  google_drive: Folder,
  google_docs: FileText,
  work_files: FileText,
  media: ImageIcon,
} as const;

function StepIcon({ step }: { step: PlanStep }) {
  if (step.connector === "media" && (step.tool ?? "").includes("video")) {
    return <Video className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (step.connector === "work_files" && step.tool === "create_spreadsheet") {
    return <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (step.connector === "work_files" && step.tool === "create_slides") {
    return <Presentation className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (step.connector === "work_files" && step.tool === "create_pdf") {
    return <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  const Icon = (step.connector && ICONS[step.connector as keyof typeof ICONS]) || FileText;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function ActionBadge({ action }: { action: string }) {
  const label = ACTION_LABEL[action];
  if (!label) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        isSevere(action)
          ? "bg-destructive/12 text-destructive"
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function PlanCard({
  step,
  index,
  live,
  total,
  onSend,
}: {
  step: PlanStep;
  index: number;
  live: boolean;
  total: number;
  onSend?: (label: string) => void;
}) {
  const reduced = useReducedMotion();
  const call = describeCall(step);
  const clickable = Boolean(onSend) && !step.done;

  const inner = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[6px] border text-[11px] font-semibold tabular-nums",
          step.done
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-background text-muted-foreground",
        )}
      >
        {step.done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "text-[14px] leading-snug font-medium",
              step.done && "text-muted-foreground line-through",
            )}
          >
            {step.label}
          </p>
          {step.action ? <ActionBadge action={step.action} /> : null}
        </div>
        {call ? (
          <p className="mt-1 flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
            <StepIcon step={step} />
            <span>{call}</span>
          </p>
        ) : null}
      </div>
    </div>
  );

  return (
    <motion.li
      initial={live ? { opacity: 0, y: reduced ? 0 : 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: "easeOut" }}
      style={{ zIndex: index + 1 }}
      className={cn(
        "relative rounded-brand border bg-card shadow-e1",
        index > 0 && "-mt-2",
      )}
    >
      {clickable ? (
        <button
          type="button"
          onClick={() => onSend!(step.label)}
          className="w-full px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
        >
          {inner}
        </button>
      ) : (
        <div className="px-4 py-3">{inner}</div>
      )}
      <span className="sr-only">
        Step {index + 1} of {total}
        {step.done ? ", done" : ""}
        {clickable ? ". Press to send." : ""}
      </span>
    </motion.li>
  );
}

export function PlanStack({
  steps,
  live = false,
  onSend,
}: {
  steps: PlanStep[];
  live?: boolean;
  onSend?: (label: string) => void;
}) {
  const shown = steps.filter((step) => !isFetchedRead(step));
  if (shown.length === 0) return null;
  return (
    <ol className="relative flex flex-col">
      {shown.map((step, i) => (
        <PlanCard
          key={`${step.label}-${i}`}
          step={step}
          index={i}
          live={live}
          total={shown.length}
          onSend={onSend}
        />
      ))}
    </ol>
  );
}
