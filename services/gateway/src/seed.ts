/**
 * Seeds the Firestore emulator with the data the UI currently hardcodes, so the
 * frontend can be pointed at a real gateway without anything appearing to
 * change. Run: npm --workspace gateway run seed
 *
 * Refuses to touch anything but an emulator — this must never be pointed at a
 * real project by accident.
 */
import { Timestamp } from "firebase-admin/firestore";

import { env } from "./env.js";
import { preferences, runs, sessions, watchers } from "./firestore.js";

if (!env.usingEmulator) {
  console.error("[seed] refusing to run: FIRESTORE_EMULATOR_HOST is not set.");
  process.exit(1);
}

const uid = env.devUserId;
const minutesAgo = (m: number) => Timestamp.fromMillis(Date.now() - m * 60_000);

const SESSIONS = [
  {
    id: "nav",
    title: "Nav wireframe",
    updatedAt: minutesAgo(12),
    done: 2,
    total: 4,
    scope: "Desktop-first",
    plan: [
      { label: "Scope the layout", done: true },
      { label: "Draft nav wireframe", done: true },
      { label: "Draft content grid", done: false },
      { label: "Review together", done: false },
    ],
    correction: {
      was: "Sidebar nav with 6 top-level items",
      now: "Sidebar nav, collapsed by default, 4 items",
    },
    companionNote:
      "I noticed you tend to trim navigation rather than add to it — I have defaulted to that here. Want me to carry it into the content grid too?",
  },
  {
    id: "grant",
    title: "Grant application draft",
    updatedAt: minutesAgo(60 * 26),
    done: 5,
    total: 6,
    scope: "Funding round 3",
    plan: [
      { label: "Pull last year's application", done: true },
      { label: "Draft the impact section", done: true },
      { label: "Draft the budget narrative", done: true },
      { label: "Cross-check eligibility", done: true },
      { label: "Rewrite the summary", done: true },
      { label: "Review together", done: false },
    ],
    correction: null,
    companionNote:
      "The budget narrative reuses your phrasing from the 2025 round. Say the word and I will rewrite it from scratch instead.",
  },
  {
    id: "contract",
    title: "Contract law, chapter 4",
    updatedAt: minutesAgo(60 * 24 * 3),
    done: 8,
    total: 8,
    scope: "Study notes",
    plan: [
      { label: "Summarise the chapter", done: true },
      { label: "Pull out the tested cases", done: true },
      { label: "Build recall questions", done: true },
      { label: "Mark the weak spots", done: true },
      { label: "Second pass on remedies", done: true },
      { label: "Draft a one-page sheet", done: true },
      { label: "Check against the syllabus", done: true },
      { label: "Review together", done: true },
    ],
    correction: null,
    companionNote:
      "This one is finished. Want me to roll the weak spots into a revision session?",
  },
];

const WATCHERS = [
  {
    id: "inquiries",
    action: "send_external",
    name: "Client inquiries",
    trigger: "New mail matching “proposal” or “quote”",
    ceiling: "draft_only",
    running: true,
    lastRunAt: minutesAgo(180),
  },
  {
    id: "transcripts",
    action: "create_task",
    name: "Meeting transcripts",
    trigger: "File lands in Meetings/",
    ceiling: "send_after_review",
    running: true,
    lastRunAt: minutesAgo(252),
  },
  {
    id: "invoices",
    action: "send_external",
    name: "Invoice reminders",
    trigger: "Invoice unpaid for 14 days",
    ceiling: "send_after_review",
    running: false,
    lastRunAt: minutesAgo(60 * 24 * 2),
  },
];

const RUNS = [
  {
    id: "run-1",
    watcherId: "inquiries",
    name: "Client inquiries",
    detail: "Proposal drafted from your past work",
    state: "awaiting_review",
    at: minutesAgo(180),
  },
  {
    id: "run-2",
    watcherId: "transcripts",
    name: "Meeting transcripts",
    detail: "4 tasks created in Nav wireframe",
    state: "done",
    at: minutesAgo(252),
  },
];

const PREFERENCES = [
  {
    id: "nav",
    area: "Navigation",
    was: "Sidebar nav with 6 top-level items",
    now: "Sidebar nav, collapsed by default, 4 items",
    evidence: "You trimmed navigation in 3 of your last 3 edits",
    revertedAt: null,
  },
  {
    id: "tone",
    area: "Writing",
    was: "Formal, full sentences in summaries",
    now: "Short, direct summaries — no preamble",
    evidence: "You shortened 7 drafts without changing their meaning",
    revertedAt: null,
  },
  {
    id: "clarify",
    area: "Questions",
    was: "Ask before every multi-step task",
    now: "Ask only when scope is genuinely ambiguous",
    evidence: "You answered “just go ahead” 5 times running",
    revertedAt: null,
  },
];

async function seed() {
  const write = async <T extends { id: string }>(
    label: string,
    collection: FirebaseFirestore.CollectionReference,
    rows: T[],
  ) => {
    const batch = collection.firestore.batch();
    for (const { id, ...data } of rows) batch.set(collection.doc(id), data);
    await batch.commit();
    console.log(`[seed] ${rows.length} ${label}`);
  };

  await write("sessions", sessions(uid), SESSIONS);
  await write("watchers", watchers(uid), WATCHERS);
  await write("runs", runs(uid), RUNS);
  await write("preferences", preferences(uid), PREFERENCES);
  console.log(`[seed] done — user "${uid}"`);
}

seed().catch((e: unknown) => {
  console.error("[seed] failed", e);
  process.exit(1);
});
