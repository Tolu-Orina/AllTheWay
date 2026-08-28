import type { ActOutcome, PlanStep } from "@alltheway/contracts";

/**
 * What a step would do outside the conversation, in the user's words.
 *
 * Shown on the card itself rather than only in the confirmation, so the
 * consequence is visible while the plan is still being read.
 */
export const ACTION_LABEL: Record<string, string> = {
  send_external: "sends",
  make_payment: "pays",
  delete_data: "deletes",
  create_task: "creates a task",
  update_record: "changes a record",
};

export function isSevere(action: string): boolean {
  return action === "send_external" || action === "make_payment" || action === "delete_data";
}

/**
 * A live read the gateway already ran this turn (calendar, Drive).
 *
 * Shown as a numbered PlanStack card it looks like a button and does nothing.
 * The answer belongs in the bubble, from LOOKUPS.
 */
export function isFetchedRead(step: PlanStep): boolean {
  return step.tool === "list_events" || step.tool === "list_files";
}

function arg(step: PlanStep, key: string): string {
  const value = step.arguments?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The call, as a sentence a person can agree to.
 *
 * Empty when the step names no call: it stays in the conversation.
 */
export function describeCall(step: PlanStep): string | null {
  if (!step.connector || !step.tool) return null;
  const to = arg(step, "to");
  const title = arg(step, "title") || arg(step, "name") || arg(step, "subject");
  const email = arg(step, "email");

  const key = `${step.connector}.${step.tool}`;
  switch (key) {
    case "google_calendar.create_event":
      return title ? `This will put “${title}” on your calendar` : "This will put something on your calendar";
    case "google_calendar.list_events":
      return "This will look at your calendar";
    case "google_calendar.delete_event":
      return "This will delete a calendar event";
    case "google_calendar.send_invite":
      return email ? `This will send a calendar invite to ${email}` : "This will send a calendar invite";
    case "google_gmail.create_draft":
      return to ? `This will draft an email to ${to}` : "This will draft an email";
    case "google_gmail.send_email":
      return to ? `This will send an email to ${to}` : "This will send an email";
    case "google_drive.list_files":
      return "This will look in your Drive";
    case "google_drive.create_file":
      return title ? `This will create “${title}” in Drive` : "This will create a file in Drive";
    case "google_drive.delete_file":
      return "This will delete a Drive file";
    case "google_docs.read_document":
      return "This will read a Google Doc";
    case "google_docs.create_document":
      return title ? `This will create a Google Doc called “${title}”` : "This will create a Google Doc";
    case "google_docs.append_text":
      return "This will add text to a Google Doc";
    case "media.generate_image":
      return "This will generate an image";
    case "media.draft_video":
      return "This will draft a video";
    case "media.render_video":
      return "This will render a video, which costs money";
    default:
      return `This will ${(step.tool ?? "act").replaceAll("_", " ")}`;
  }
}

export function outcomeLine(row: ActOutcome): string {
  if (row.did === "done") return row.detail || "Done.";
  if (row.did === "refused") return row.detail || "That was not permitted. Nothing was changed.";
  if (row.did === "skipped") return row.detail || "That step was skipped.";
  return row.detail || "That did not go through. Nothing was changed by this step.";
}

export function decisionCopy(
  kind: "confirmed" | "declined" | "corrected",
  recorded: "pending" | "ok" | "failed",
  did: ActOutcome[],
): string {
  if (recorded === "pending") {
    if (kind === "corrected") return "Saving what to do instead…";
    return kind === "confirmed" ? "Saving your answer…" : "Nothing was done. Saving your answer…";
  }
  if (recorded === "failed") {
    if (kind === "corrected") return "That could not be saved. You can still say it again.";
    return kind === "confirmed"
      ? "Nothing was done, but your answer could not be saved. Nothing ran."
      : "Nothing was done, but your answer could not be saved.";
  }
  if (kind === "corrected") return "Remembered. Nothing ran.";
  if (kind === "declined") return "Declined and recorded. Nothing was done.";
  if (did.length === 0) return "Recorded. Nothing needed to run.";
  return did.map(outcomeLine).join(" ");
}
