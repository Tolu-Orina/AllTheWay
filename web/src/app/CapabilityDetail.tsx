import { AlertTriangle, ShieldCheck, ShieldX } from "lucide-react";

import { useT } from "@/app/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type CapabilitySkill = {
  id: string;
  name: string;
  description: string;
};

export type WorkCta = {
  seed: string;
  promptOnly?: boolean;
  labelKey: string;
};

export function workCtaFor(agentId: string): WorkCta | null {
  switch (agentId) {
    case "librarian":
      return { seed: "Help me read a document I will upload", labelKey: "specialists.startInWork" };
    case "orchestrator":
      return { seed: "Draft a layout", labelKey: "specialists.startInWork" };
    case "scribe":
      return { seed: "Note my next meeting", labelKey: "specialists.startInWork" };
    case "research-cell":
      return { seed: "Find out about …", promptOnly: true, labelKey: "specialists.startInWork" };
    case "document-cell":
      return { seed: "Draft a presentation", labelKey: "specialists.makeADocument" };
    default:
      return null;
  }
}

export function asideFor(agentId: string): string | null {
  if (agentId === "document-cell") return "specialists.runsAfterYes";
  if (agentId === "connector-gateway") return "specialists.enforcesConnectors";
  return null;
}

export function CapabilityDetail({
  open,
  onOpenChange,
  title,
  description,
  owner,
  version,
  skills,
  trusted,
  suspect,
  signatureSummary,
  aside,
  ctaLabel,
  onCta,
  starting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  owner?: string;
  version?: string;
  skills: CapabilitySkill[];
  trusted: boolean;
  suspect: boolean;
  signatureSummary?: string;
  aside?: string | null;
  ctaLabel?: string;
  onCta?: () => void;
  starting?: boolean;
}) {
  const t = useT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <DialogTitle>{title}</DialogTitle>
            <span
              className={cn(
                "mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
                trusted
                  ? "border-primary/30 text-muted-foreground"
                  : "border-destructive/40 text-destructive",
              )}
            >
              {trusted ? (
                <ShieldCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <ShieldX className="size-3.5" aria-hidden="true" />
              )}
              {trusted ? t("specialists.verified") : t("specialists.unverified")}
            </span>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 pb-6">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
            {owner ? (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t("specialists.owner")}</dt>
                <dd className="font-medium">{owner}</dd>
              </div>
            ) : null}
            {version ? (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t("specialists.card")}</dt>
                <dd className="font-medium tabular-nums">{version}</dd>
              </div>
            ) : null}
          </dl>

          {skills.length ? (
            <div>
              <h3 className="text-[12px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {t("specialists.publishedSkills")}
              </h3>
              <ul className="mt-2 flex flex-col gap-2.5">
                {skills.map((skill) => (
                  <li key={skill.id}>
                    <p className="text-[13.5px] font-medium">{skill.name || skill.id}</p>
                    {skill.description ? (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                        {skill.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {aside ? <p className="text-[13px] leading-relaxed text-muted-foreground">{aside}</p> : null}

          {suspect ? (
            <p className="flex items-start gap-1.5 text-[12.5px] text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {signatureSummary ?? t("specialists.cardCouldNotBeVerified")}{" "}
                {t("common.nothingHereIsAttestedIncludingThe")}
              </span>
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" onClick={() => onOpenChange(false)}>
              {t("specialists.close")}
            </Button>
            {ctaLabel && onCta ? (
              <Button
                type="button"
                variant="brand"
                size="lg"
                disabled={starting}
                onClick={onCta}
              >
                {ctaLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
