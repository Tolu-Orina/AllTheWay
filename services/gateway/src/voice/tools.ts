import { Timestamp } from "firebase-admin/firestore";

import { env } from "../env.js";
import { authenticatingFetch, connectorClient, connectorInvokeMessage } from "../a2a.js";
import { db, userDoc } from "../firestore.js";
import { buildDigest } from "../repos/digest.js";
import {
  connectorIsConnected,
  enforcementGrant,
  GMAIL_DRAFTS_SCOPE,
  googleGrantId,
} from "../google-scopes.js";
import { groundedLookup } from "../look-up-run.js";
import { rememberCalendarTimeZone } from "../repos/clock.js";
import { END_THIS_CONVERSATION } from "./hangup.js";

export const THEY_SAID_YES = "they_said_yes";
export const THEY_SAID_NO = "they_said_no";

/**
 * What a voice session may look up for itself.
 *
 * ## Reads here, writes through the planner
 *
 * Every tool below only reads. Anything that sends, pays, deletes, or writes a
 * record stays on `plan_turn`, which goes to the planner and stops at the
 * confirm gate — a spoken sentence must never be one mishearing away from an
 * irreversible action. Leaving the conversation is a third thing: it closes
 * the socket, it does not confirm a plan, and it is not a read.
 *
 * That split is also why these exist at all. Routing "what's on today" through
 * a planning pass costs a second round trip while someone waits in silence, and
 * the planner is explicitly forbidden from acting or fetching, so it could only
 * ever have answered from the words it was given. Asked about a meeting, it had
 * nothing to look at.
 *
 * ## Every tool answers, including when it cannot
 *
 * A tool that throws leaves the model with nothing to say, and it will usually
 * invent something rather than stay silent. So each returns a plain object with
 * either the answer or a `cannot` explaining why — "your calendar is not
 * connected" is a true sentence the model can speak, and it is the one that
 * tells the user what to do next.
 */

/** Long enough for a cold service, short enough not to strand a conversation. */
const TOOL_TIMEOUT_MS = 8_000;
/**
 * A calendar read is: A2A to the connector gateway + OAuth refresh + two MCP
 * subprocesses + Google. Six seconds used to lose to a Cloud Run cold start
 * and come back as "I could not reach your calendar".
 */
const CONNECTOR_READ_MS = 20_000;

export type ToolResult = Record<string, unknown>;

/**
 * The declarations sent to the live model.
 *
 * Named the way a person would ask, because the model chooses between them from
 * the name and description alone. `whats_on_my_calendar` is picked correctly for
 * "what have I got later"; a name like `calendar_read` is not.
 */
export const READ_TOOLS = [
  {
    name: "whats_on_my_calendar",
    description:
      "What is on the user's calendar. Use this whenever they ask about their day, " +
      "their schedule, a meeting, a reminder, an event, or whether they are free. Read-only.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: {
          type: "NUMBER",
          description: "How many events to look at. Default 10.",
        },
        time_min: {
          type: "STRING",
          description:
            "RFC 3339 start of the window. Use the start of today when they ask about " +
            "today's meetings or whether they already had something today. Use the start " +
            "of yesterday (midnight UTC the previous day) when they ask about yesterday, " +
            "last night, or the day before.",
        },
      },
    },
  },
  {
    name: "look_this_up",
    description:
      "Look up a public fact on the web. Use this for news, the weather, a " +
      "public figure, a regulation, or anything not in their documents, mail, " +
      "or calendar. Read-only. If it cannot check, say so — never guess.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "What to look up, in the user's words." },
      },
      required: ["query"],
    },
  },
  {
    name: "ask_my_documents",
    description:
      "Search what the user has added — contracts, specs, notes — and return passages " +
      "with their sources. Use this when they ask what something says or what was agreed " +
      "in writing. Read-only.",
    parameters: {
      type: "OBJECT",
      properties: {
        query: { type: "STRING", description: "What to look for, in the user's words." },
      },
      required: ["query"],
    },
  },
  {
    name: "whats_waiting_for_me",
    description:
      "Anything waiting on the user's decision, and what ran for them recently. Use this " +
      "for 'what needs me', 'what happened overnight', or 'anything waiting'. Read-only.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "find_in_my_drive",
    description:
      "List files in the user's Google Drive. Use this when they ask what they have, " +
      "to find a file by name, or before saving notes there. Read-only.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "NUMBER", description: "How many files. Default 10." },
      },
    },
  },
  {
    name: "read_a_google_doc",
    description:
      "Read the contents of one Google Doc the user names, by its document id. Use " +
      "this after finding it in Drive. Read-only.",
    parameters: {
      type: "OBJECT",
      properties: {
        document_id: { type: "STRING", description: "The Google Doc id." },
      },
      required: ["document_id"],
    },
  },
  {
    name: "my_recent_meetings",
    description:
      "Meetings the companion took notes in, and what was said to be committed to. Use " +
      "this for 'what did we agree', not for what is scheduled — scheduled meetings are " +
      "on the calendar. Read-only.",
    parameters: {
      type: "OBJECT",
      properties: {
        limit: { type: "NUMBER", description: "How many recent meetings. Default 5." },
      },
    },
  },
  {
    name: "gmail_account",
    description:
      "Whether Gmail is connected. Use this when they want to send mail or compose a draft. " +
      "Does not send, and does not read the inbox. Always call plan_turn to compose even if " +
      "drafts is false — they review the draft on screen. Missing drafts permission is only " +
      "said after they confirm, never as a reason to refuse to compose.",
    parameters: { type: "OBJECT", properties: {} },
  },
] as const;

export const READ_TOOL_NAMES: ReadonlySet<string> = new Set(READ_TOOLS.map((t) => t.name));

/**
 * Closes the live session. Not a read, and not `plan_turn`: hanging up must
 * not be one mishearing away from sending mail, and it must not be folded
 * into a lookup the model might call while still talking.
 */
export const SESSION_TOOLS = [
  {
    name: THEY_SAID_YES,
    description:
      "Carry out the plan you already proposed, because they just said yes. " +
      "Call this when they confirm — yes, yeah, go ahead, yes please, do it — after " +
      "plan_turn returned a confirm. Do not call plan_turn again for that yes. " +
      "Do not call this unless they clearly confirmed. Do not claim the work is done " +
      "until this returns.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: THEY_SAID_NO,
    description:
      "Stop the plan you already proposed, because they said no. Nothing is sent, " +
      "created, or deleted. Call this when they decline — no, stop, cancel, don't. " +
      "Leaving the conversation is end_this_conversation, not this.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: END_THIS_CONVERSATION,
    description:
      "End this live voice session. Call this only when they are leaving the conversation " +
      "itself — goodbye, bye, that's all, you can stop, I'm done talking. Speak a short " +
      "farewell in their language first, then call this. Do not wait for a yes. " +
      "Do not call this when they want you to stop a task, a reminder, an email, or " +
      "anything they asked you to do — that is plan_turn. Leaving is not confirmation of " +
      "a pending plan.",
    parameters: { type: "OBJECT", properties: {} },
  },
] as const;

export const SESSION_TOOL_NAMES: ReadonlySet<string> = new Set(SESSION_TOOLS.map((t) => t.name));

function num(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/**
 * Ask the Agent Gateway for something, on this user's behalf.
 *
 * `confirmed` is deliberately absent: these are reads, and the connector
 * gateway's own floor decides what a read may do. Sending `confirmed: true`
 * from here would be this service asserting a person said yes to something
 * nobody showed them.
 */
async function connectorRead(
  uid: string,
  connector: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!env.connectorGatewayUrl) {
    return { cannot: "Connections are not available in this environment." };
  }

  const grant = await db.collection("connectorGrants").doc(googleGrantId(uid)).get();
  const scopes: string[] = grant.exists ? (grant.get("scopes") ?? []) : [];
  if (!grant.exists || !connectorIsConnected(connector, scopes)) {
    return {
      cannot: `Your ${connector} account is not connected yet. It can be connected from Profile.`,
      connector,
    };
  }

  const client = await connectorClient();
  const result = await Promise.race([
    client.sendMessage({
      tenant: uid,
      message: connectorInvokeMessage(`voice-${Date.now().toString(36)}`, {
        connector,
        tool,
        arguments: args,
        grant: enforcementGrant(connector, tool),
      }),
      configuration: undefined,
      metadata: undefined,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("the connector did not answer in time")), CONNECTOR_READ_MS),
    ),
  ]);

  // The connector-gateway returns data via A2A data parts, not text parts.
  // Attempt structured extraction first; fall back to text for error messages.
  return toolResultFromConnector(dataOfTask(result), textOfTask(result));
}

/**
 * Turn a connector task into something the model can speak.
 *
 * A refusal used to be returned as `{ error, refusal, reason }` without
 * `cannot`, so the planner treated a revoked grant as a successful empty
 * calendar. AUTH_REQUIRED and REJECTED both land here.
 */
export function toolResultFromConnector(
  data: Record<string, unknown> | null,
  text: string,
): ToolResult {
  if (data) {
    if (typeof data.cannot === "string" && data.cannot.trim()) {
      return { cannot: data.cannot };
    }
    const refusal = typeof data.refusal === "string" ? data.refusal : "";
    const reason =
      (typeof data.reason === "string" && data.reason.trim()) ||
      (typeof data.error === "string" && data.error.trim()) ||
      "";
    if (refusal || reason) {
      return { cannot: reason || "That connection could not be used just now." };
    }
    return data;
  }
  return text ? { result: text } : { cannot: "The connector returned no data." };
}

/**
 * Extract the structured payload from an A2A data part.
 *
 * The connector-gateway wraps connector results as:
 *   part.content.{ $case: "data", value: { data: <actual_result>, trace: {...} } }
 *
 * `textOfTask` cannot find this because calendar events have `title`/`startsAt`,
 * Drive files have `name`/`link` — neither has a property called `text`.
 */
function dataOfTask(task: unknown): Record<string, unknown> | null {
  const walk = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== "object") return null;
    const rec = node as Record<string, unknown>;
    // Protobuf oneof: content.$case === "data"
    if (rec.$case === "data" && rec.value && typeof rec.value === "object") {
      const val = rec.value as Record<string, unknown>;
      // connector-gateway always wraps: { data: <result>, trace: {...} }
      const payload = val.data && typeof val.data === "object" ? val.data : val;
      const p = payload as Record<string, unknown>;
      // Only return if the payload has something useful beyond trace metadata
      if (Object.keys(p).some((k) => k !== "trace")) {
        return p;
      }
    }
    for (const v of Object.values(rec)) {
      const found = Array.isArray(v)
        ? v.reduce<Record<string, unknown> | null>((acc, item) => acc ?? walk(item), null)
        : walk(v);
      if (found) return found;
    }
    return null;
  };
  return walk(task);
}

/** The readable text of whatever the agent sent back. Used for error messages and docs. */
function textOfTask(task: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (typeof rec.text === "string" && rec.text.trim()) parts.push(rec.text);
    for (const value of Object.values(rec)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  };
  walk(task);
  return parts.join(" ").slice(0, 4000);
}

async function upstreamJson(
  base: string,
  path: string,
  uid: string,
  init: RequestInit = {},
): Promise<unknown> {
  const fetchImpl = authenticatingFetch(base);
  const response = await fetchImpl(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-User-Id": uid, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return JSON.parse((await response.text()) || "{}");
}

/**
 * Run one read tool.
 *
 * Never throws. A tool call that rejects would leave the model holding an empty
 * result at the exact moment it is about to speak, and an empty result is what
 * a confident invention looks like from the inside.
 */
function calendarZoneOf(result: ToolResult): string {
  if (!result || typeof result !== "object") return "";
  const rec = result as Record<string, unknown>;
  if (typeof rec.timeZone === "string") return rec.timeZone;
  if (typeof rec.time_zone === "string") return rec.time_zone;
  if (typeof rec.result === "string") {
    try {
      const parsed = JSON.parse(rec.result) as Record<string, unknown>;
      if (typeof parsed.timeZone === "string") return parsed.timeZone;
      if (typeof parsed.time_zone === "string") return parsed.time_zone;
    } catch {
      /* not JSON */
    }
  }
  return "";
}

export async function runReadTool(
  uid: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "whats_on_my_calendar": {
        const call: Record<string, unknown> = { limit: num(args.limit, 10, 25) };
        const timeMin = typeof args.time_min === "string" ? args.time_min.trim() : "";
        if (timeMin) call.time_min = timeMin;
        const result = await connectorRead(uid, "google_calendar", "list_events", call);
        const zone = calendarZoneOf(result);
        if (zone) void rememberCalendarTimeZone(uid, zone);
        return result;
      }

      case "look_this_up": {
        const query = String(args.query ?? "").trim();
        if (!query) return { cannot: "I need to know what to look up." };
        return await groundedLookup(query);
      }

      case "find_in_my_drive":
        return await connectorRead(uid, "google_drive", "list_files", {
          limit: num(args.limit, 10, 25),
        });

      case "read_a_google_doc": {
        const id = String(args.document_id ?? "").trim();
        if (!id) return { cannot: "I need the document to read." };
        return await connectorRead(uid, "google_docs", "read_document", { document_id: id });
      }

      case "ask_my_documents": {
        if (!env.librarianUrl) return { cannot: "Documents are not available here." };
        const query = String(args.query ?? "").trim();
        if (!query) return { cannot: "I need to know what to look for." };
        const found = await upstreamJson(env.librarianUrl, "/retrieve", uid, {
          method: "POST",
          body: JSON.stringify({ query, limit: 5 }),
        });
        return { found };
      }

      case "whats_waiting_for_me": {
        // Local: this one is served from Firestore by this process, so it is the
        // fastest thing here and never depends on another service being warm.
        const digest = await buildDigest(uid);
        return {
          awaitingDecision: digest.awaitingDecision,
          ranWatchers: digest.ranWatchers,
          artifactsChanged: digest.artifactsChanged,
        };
      }

      case "gmail_account": {
        const grant = await db.collection("connectorGrants").doc(googleGrantId(uid)).get();
        const scopes: string[] = grant.exists ? (grant.get("scopes") ?? []) : [];
        if (!grant.exists || !connectorIsConnected("google_gmail", scopes)) {
          return {
            cannot:
              "Your Gmail account is not connected yet. Connect it from Profile. Sending and drafts both need that connection, and drafts need the extra drafts permission which is off unless you asked for it.",
            connector: "google_gmail",
          };
        }
        const drafts = scopes.includes(GMAIL_DRAFTS_SCOPE);
        return {
          connected: true,
          send: true,
          drafts,
          note: drafts
            ? "Gmail is connected. Call plan_turn so they can review a draft. Sending and saving both wait for yes."
            : "Gmail is connected. Always call plan_turn so they can review a draft on screen. Do not say you cannot save drafts, and do not refuse to compose. If drafts permission is off, that is said only after they confirm.",
        };
      }

      case "my_recent_meetings": {
        if (!env.scribeUrl) return { cannot: "Meetings are not available here." };
        const body = (await upstreamJson(env.scribeUrl, "/meetings", uid)) as {
          meetings?: unknown[];
        };
        const meetings = (body.meetings ?? []).slice(0, num(args.limit, 5, 20));
        return { meetings };
      }

      default:
        return { cannot: `There is no tool called ${name}.` };
    }
  } catch (err) {
    // The message is for the model to relay, so it says what happened in a
    // sentence a person could hear without alarm.
    console.warn(`[voice-tools] ${name} failed: ${(err as Error).message}`);
    const msg = (err as Error).message || "";
    if (/did not answer in time/i.test(msg)) {
      return { cannot: "I could not reach that just now. Ask me again in a moment." };
    }
    if (/auth|consent|connect|grant/i.test(msg)) {
      return {
        cannot:
          "That Google account needs to be connected again. You can do that from Profile.",
      };
    }
    return { cannot: "I could not reach that just now. Ask me again in a moment." };
  }
}

/** Exported for tests: the Firestore handle these tools read grants from. */
export const _internals = { userDoc, Timestamp };
