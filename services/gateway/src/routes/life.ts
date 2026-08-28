import express from "express";
import { z } from "zod";

import { HatSchema } from "@alltheway/contracts";

import { requireUser } from "../auth.js";
import { retrieve } from "../repos/retrieval.js";
import { hatFromTitle } from "../calendar-day.js";
import { actOnConfirmed } from "../act.js";
import {
  createPerson,
  createPlace,
  createProposed,
  createReminder,
  createRhythm,
  deleteRhythm,
  dismissReminder,
  listPeople,
  listPlaces,
  listProposed,
  listReminders,
  listRhythms,
  setProposedState,
} from "../repos/life.js";
import { listWatchers, writeAwaitingRun } from "../repos/watchers.js";

/**
 * Life: people, places, rhythms, reminders, proposed commitments.
 *
 * Calendar writes still go through confirm. Propose never creates an event.
 * Accepting a proposal is the same consent as Yes on a plan.
 */

export const lifeRoutes = express.Router();

const PersonBody = z.object({
  name: z.string().min(1).max(80),
  relation: z.string().max(80).optional(),
});

const PlaceBody = z.object({
  label: z.string().min(1).max(80),
  bufferMinutes: z.number().int().min(0).max(180).optional(),
  hat: HatSchema.optional(),
});

const RhythmBody = z.object({
  title: z.string().min(1).max(120),
  hat: HatSchema,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  timeZone: z.string().max(80).optional(),
  personId: z.string().max(128).optional(),
  placeId: z.string().max(128).optional(),
});

const ReminderBody = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(["leave", "start", "prepare"]).default("start"),
  fireAt: z.string().min(1),
  hat: HatSchema.optional(),
});

const ProposeBody = z.object({
  documentId: z.string().min(1).max(128),
});

lifeRoutes.get("/people", requireUser, async (req, res) => {
  res.json(await listPeople(req.uid!));
});

lifeRoutes.post("/people", requireUser, async (req, res) => {
  const body = PersonBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "A name is needed." });
  }
  res.json(await createPerson(req.uid!, body.data));
});

lifeRoutes.get("/places", requireUser, async (req, res) => {
  res.json(await listPlaces(req.uid!));
});

lifeRoutes.post("/places", requireUser, async (req, res) => {
  const body = PlaceBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "A place label is needed." });
  }
  res.json(await createPlace(req.uid!, body.data));
});

lifeRoutes.get("/rhythms", requireUser, async (req, res) => {
  res.json(await listRhythms(req.uid!));
});

lifeRoutes.post("/rhythms", requireUser, async (req, res) => {
  const body = RhythmBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "A rhythm needs a title, days and a time." });
  }
  res.json(await createRhythm(req.uid!, body.data));
});

lifeRoutes.delete("/rhythms/:id", requireUser, async (req, res) => {
  await deleteRhythm(req.uid!, param(req, "id"));
  res.json({ ok: true });
});

lifeRoutes.get("/reminders", requireUser, async (req, res) => {
  res.json(await listReminders(req.uid!, ["scheduled", "fired"]));
});

lifeRoutes.post("/reminders", requireUser, async (req, res) => {
  const body = ReminderBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "A reminder needs a title and a time." });
  }
  res.json(await createReminder(req.uid!, body.data));
});

lifeRoutes.post("/reminders/:id/dismiss", requireUser, async (req, res) => {
  const row = await dismissReminder(req.uid!, param(req, "id"));
  if (!row) return res.status(404).json({ code: "not_found", message: "That reminder is not here." });
  res.json(row);
});

lifeRoutes.get("/proposed", requireUser, async (req, res) => {
  res.json(await listProposed(req.uid!));
});

lifeRoutes.post("/propose", requireUser, async (req, res) => {
  const body = ProposeBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ code: "invalid_request", message: "Which document?" });
  }
  const created = await proposeFromDocument(req.uid!, body.data.documentId);
  res.json(created);
});

lifeRoutes.post("/proposed/:id/accept", requireUser, async (req, res) => {
  const uid = req.uid!;
  const row = await setProposedState(uid, param(req, "id"), "accepted");
  if (!row) return res.status(404).json({ code: "not_found", message: "That proposal is not here." });
  if (row.startsAt) {
    await actOnConfirmed({
      uid,
      sessionId: "life",
      steps: [
        {
          label: row.title,
          connector: "google_calendar",
          tool: "create_event",
          arguments: { title: row.title, starts_at: row.startsAt },
        },
      ],
    }).catch((err) => {
      console.warn(`[life] calendar create after accept: ${(err as Error).message}`);
    });
  }
  res.json(row);
});

lifeRoutes.post("/proposed/:id/decline", requireUser, async (req, res) => {
  const row = await setProposedState(req.uid!, param(req, "id"), "declined");
  if (!row) return res.status(404).json({ code: "not_found", message: "That proposal is not here." });
  res.json(row);
});

function param(req: express.Request, name: string): string {
  const raw = req.params[name];
  return Array.isArray(raw) ? raw[0]! : raw!;
}

/**
 * After a file is indexed: propose dates if any, and wake document_indexed
 * watchers as awaiting_review runs — they must not write the calendar.
 */
export async function onDocumentReady(uid: string, documentId: string, title: string): Promise<void> {
  await proposeFromDocument(uid, documentId, title);
  const watchers = await listWatchers(uid);
  const hits = watchers.filter((w) => w.running && w.triggerKind === "document_indexed");
  for (const watcher of hits) {
    await writeAwaitingRun(uid, {
      watcherId: watcher.id,
      name: watcher.name,
      detail: `Proposed dates from “${title}”. Nothing was added to the calendar.`,
    });
  }
}

async function proposeFromDocument(uid: string, documentId: string, title = "") {
  const passages = await retrieve(uid, "dates times events school church pickup choir soccer");
  const fromDoc = passages.filter((p) => !documentId || p.documentId === documentId);
  const text = fromDoc.map((p) => p.text).join("\n");
  const sourceTitle = title || fromDoc[0]?.title || "Uploaded file";
  const found = extractCommitments(text);
  if (!found.length) {
    if (!looksLikeLife(sourceTitle, text)) return [];
    return [
      await createProposed(uid, {
        title: `Review dates in ${sourceTitle}`,
        startsAt: null,
        hat: hatFromTitle(sourceTitle),
        sourceDocumentId: documentId,
        sourceTitle,
        detail: "No clear date was read. Nothing was added to the calendar.",
      }),
    ];
  }
  const created = [];
  for (const row of found.slice(0, 8)) {
    created.push(
      await createProposed(uid, {
        title: row.title,
        startsAt: row.startsAt,
        hat: hatFromTitle(row.title),
        sourceDocumentId: documentId,
        sourceTitle,
        detail: row.detail,
      }),
    );
  }
  return created;
}

const DATE_LINE =
  /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?|\d{4}-\d{2}-\d{2})[^\n]{0,80}/gi;

export function extractCommitments(text: string): Array<{ title: string; startsAt: string | null; detail: string }> {
  const out: Array<{ title: string; startsAt: string | null; detail: string }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DATE_LINE)) {
    const line = match[0].replace(/\s+/g, " ").trim();
    if (line.length < 6 || seen.has(line)) continue;
    seen.add(line);
    out.push({
      title: line.slice(0, 80),
      startsAt: isoFromSnippet(line),
      detail: line,
    });
  }
  return out;
}

export function looksLikeLife(title: string, text = ""): boolean {
  const blob = `${title} ${text.slice(0, 400)}`;
  return hatFromTitle(blob) !== "work" || /\b(school|church|pickup|choir|soccer|football)\b/i.test(blob);
}

function isoFromSnippet(line: string): string | null {
  const iso = line.match(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/);
  if (iso) {
    const raw = iso[0].includes("T") || iso[0].includes(" ") ? iso[0].replace(" ", "T") : `${iso[0]}T09:00`;
    const d = new Date(raw.endsWith("Z") ? raw : `${raw}:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
