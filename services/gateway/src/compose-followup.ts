import type { PlanStep } from "@alltheway/contracts";

/**
 * Fill a pending Gmail draft from a follow-up, instead of planning a second one.
 *
 * "The message is about QA tomorrow" used to call the planner again, which
 * opened a new confirm with empty To/Subject/Body. The overlay form is already
 * the review; later speech belongs in those fields.
 */

const SEND_THIS_DRAFT = /\bsend (?:this|that|the) draft\b/i;
const OTHER_WRITE = /\b(?:schedule|calendar|pay|invoice|delete|remove)\b/i;
const STILL_EMAIL = /email|gmail|draft|message|mail|@/i;
const ABOUT = /\b(?:about|regarding|re:)\s+(.+)/is;
const MESSAGE_IS =
  /\b(?:the )?(?:message|email|mail|body)\s+(?:is|should be|says|should say)\s+(.+)/is;
const TRAILING_POLITE = /\s+(please|today|tomorrow)\s*$/i;
const WRAPPER_ONLY =
  /^(?:please\s+|i (?:want|would like|'d like) to\s+|can you\s+|could you\s+)*(?:send|email|compose|draft)\s+(?:(?:an?\s+)?(?:email|message|mail|draft)\s+)?(?:to\s+[A-Za-z][\w'.-]+)?\s*$/i;

function isGmailDraft(step: PlanStep): boolean {
  const connector = step.connector ?? "";
  return step.tool === "create_draft" && (!connector || connector === "google_gmail" || connector === "gmail");
}

export function emailsIn(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(/[\w.+-]+@[\w.-]+\.\w+/gi)) {
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match[0]);
  }
  return out;
}

function aboutClause(text: string): string {
  const match = ABOUT.exec(text);
  if (!match) return "";
  return match[1].trim().replace(TRAILING_POLITE, "").replace(/[ .,]+$/, "").trim();
}

export function bodyFromUtterance(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (emailsIn(trimmed).length === 1 && trimmed === emailsIn(trimmed)[0]) return "";
  const said = MESSAGE_IS.exec(trimmed);
  if (said) {
    const rest = said[1].trim();
    return aboutClause(rest) || rest;
  }
  const about = aboutClause(trimmed);
  if (about) return about;
  if (WRAPPER_ONLY.test(trimmed)) return "";
  return trimmed;
}

function clip(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max).trimEnd();
}

export function draftSummary(arguments_: Record<string, unknown> | undefined): string {
  const to = String(arguments_?.to ?? "").trim();
  const subject = String(arguments_?.subject ?? "").trim();
  const body = String(arguments_?.body ?? "").trim();
  const who = to || "them";
  let lead = `This will save a Gmail draft to ${who}`;
  if (subject) lead += ` regarding ${subject}`;
  lead += ".";
  const asks: string[] = [];
  if (!to.includes("@")) {
    asks.push(to ? `What's ${to}'s email address?` : "What's the email address?");
  }
  if (!body) asks.push("What should the message say?");
  if (asks.length) return `${lead} ${asks.join(" ")}`;
  return `${lead} Should I save it?`;
}

export function composeNeedsAddress(plan: PlanStep[]): boolean {
  const step = plan.find(isGmailDraft);
  if (!step) return false;
  return !String(step.arguments?.to ?? "").includes("@");
}

export type ComposeConfirm = {
  summary: string;
  options: string[];
  actions: Array<{
    label: string;
    action: string;
    reason: string;
    connector: string;
    tool: string;
    arguments: Record<string, unknown>;
  }>;
};

export function composeConfirmFromPlan(plan: PlanStep[]): ComposeConfirm | null {
  const step = plan.find(isGmailDraft);
  if (!step) return null;
  const args = { ...(step.arguments ?? {}) };
  return {
    summary: draftSummary(args),
    options: ["Save draft", "No, stop"],
    actions: [
      {
        label: step.label,
        action: step.action || "draft",
        reason: "Review the details before this is saved.",
        connector: step.connector || "google_gmail",
        tool: "create_draft",
        arguments: args,
      },
    ],
  };
}

export function applyComposeFollowUp(plan: PlanStep[], utterance: string): PlanStep[] | null {
  const text = utterance.trim();
  if (!text || SEND_THIS_DRAFT.test(text)) return null;
  const idx = plan.findIndex(isGmailDraft);
  if (idx < 0) return null;
  if (OTHER_WRITE.test(text) && !STILL_EMAIL.test(text)) return null;

  const args = { ...(plan[idx].arguments ?? {}) };
  const found = emailsIn(text);
  if (found.length) {
    args.to = found.join(", ");
  } else {
    const bodyBit = bodyFromUtterance(text);
    const about = aboutClause(text);
    if (about && !String(args.subject ?? "").trim()) {
      args.subject = clip(about, 80);
    }
    if (bodyBit) {
      const existing = String(args.body ?? "").trim();
      args.body = existing ? `${existing}\n\n${bodyBit}` : bodyBit;
      if (!String(args.subject ?? "").trim()) {
        args.subject = clip((bodyBit.split("\n")[0] ?? ""), 80);
      }
    }
  }
  return plan.map((step, i) => (i === idx ? { ...step, arguments: args } : step));
}

export function composeFollowUpTurn(
  plan: PlanStep[],
  utterance: string,
): {
  decision: "confirm";
  plan: PlanStep[];
  confirm: ComposeConfirm;
  note: string;
} | null {
  const next = applyComposeFollowUp(plan, utterance);
  if (!next) return null;
  const confirm = composeConfirmFromPlan(next);
  if (!confirm) return null;
  return { decision: "confirm", plan: next, confirm, note: confirm.summary };
}
