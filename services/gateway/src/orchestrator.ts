import { Role, TaskState, type Message, type Part, type Task } from "@a2a-js/sdk";
import {
  CitationSchema,
  PlanStepSchema,
  ProposedActionSchema,
  type Citation,
  type PlanStep,
  type TurnEvent,
} from "@alltheway/contracts";
import { z } from "zod";

import { orchestratorClient } from "./a2a.js";

/**
 * Drives the orchestrator over A2A and translates the result into the wire
 * contract the web client already knows.
 *
 * The translation is deliberate rather than a leak: A2A task states are the
 * protocol's vocabulary, `decision: "clarify" | "plan"` is the product's.
 * Keeping the mapping here means the browser never learns A2A, and
 * `@alltheway/contracts` is unchanged by this migration.
 *
 *   TASK_STATE_INPUT_REQUIRED  ->  clarify   (the Clarify Gate)
 *   TASK_STATE_COMPLETED       ->  plan
 *   anything else              ->  thrown, surfaced as a typed ApiError
 *
 * Note both `Role` and `TaskState` are numeric protobuf enums in this SDK, not
 * strings. Comparing against string names silently yields UNRECOGNIZED.
 */

export const TurnResponseSchema = z.object({
  decision: z.enum(["clarify", "plan", "confirm"]),
  clarify: z
    .object({ question: z.string(), options: z.array(z.string()) })
    .nullable()
    .optional(),
  /** Present when the plan is ready but must not run until the user agrees. */
  confirm: z
    .object({
      summary: z.string(),
      options: z.array(z.string()).default([]),
      actions: z.array(ProposedActionSchema).default([]),
    })
    .nullable()
    .optional(),
  plan: z.array(PlanStepSchema).default([]),
  note: z.string().default(""),
  trace: z.array(z.string()).default([]),
  citations: z.array(CitationSchema).default([]),
});

export type TurnResponse = z.infer<typeof TurnResponseSchema>;

export type TurnInput = {
  sessionId: string;
  userId: string;
  message: string;
  knownPreferences: string[];
  /**
   * Passages retrieved for this turn, with their citation ids.
   *
   * Retrieved by the gateway rather than the orchestrator: only this service
   * can mint a scope token, and the orchestrator is stateless by design. See
   * repos/retrieval.ts.
   */
  passages?: {
    chunkId: string;
    documentId: string;
    title: string;
    page: number;
    text: string;
  }[];
  /**
   * Live connected-account reads for this turn, already fetched.
   *
   * Same channel as passages: the orchestrator is stateless and cannot hold a
   * connector grant. Empty when the utterance did not ask for a lookup.
   */
  lookups?: string[];
  /**
   * Recent bubbles in this session, already stored.
   *
   * The orchestrator is stateless. Without these, a follow-up is planned as
   * if it were the whole request, and generate-an-image interviews forever.
   */
  thread?: string[];
};

/** Parts are a tagged union; pull out the structured `data` payloads. */
function dataPayloads(parts: Part[]): Record<string, unknown>[] {
  return parts
    .map((part) => (part.content?.$case === "data" ? part.content.value : undefined))
    .filter((value): value is Record<string, unknown> => !!value && typeof value === "object");
}

function textOf(parts: Part[]): string | undefined {
  for (const part of parts) {
    if (part.content?.$case === "text") return part.content.value;
  }
  return undefined;
}

/**
 * The plan arrives as one `{ step }` part per step plus a closing part holding
 * the note and trace — the same representation whether it was streamed in
 * chunks or folded into a finished task. One shape, both paths.
 */
function stepsOf(payloads: Record<string, unknown>[]): PlanStep[] {
  const out: PlanStep[] = [];
  for (const part of payloads) {
    const parsed = PlanStepSchema.safeParse(part.step);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Citations the orchestrator already checked. Drop malformed ones rather than
 * failing the turn — an unusable footnote is not a reason to lose the plan.
 *
 * `text` is required: the chip opens the passage that was in the prompt
 * (FR-D2). A citation that is only an id would force a second fetch, which is
 * how another user's chunk gets opened.
 */
function citationsOf(payloads: Record<string, unknown>[]): Citation[] {
  const part = payloads.find((p) => Array.isArray(p.citations));
  if (!part) return [];
  const out: Citation[] = [];
  for (const item of part.citations as unknown[]) {
    const parsed = CitationSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function buildMessage(input: TurnInput): Message {
  return {
    messageId: `${input.sessionId}-${Date.now()}`,
    contextId: input.sessionId,
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      {
        content: { $case: "text", value: input.message },
        metadata: undefined,
        filename: "",
        mediaType: "",
      },
    ],
    // Preferences travel as metadata, never appended to the user's text:
    // concatenating them makes context indistinguishable from something the
    // user said, which is the shape prompt injection takes.
    metadata: {
      knownPreferences: input.knownPreferences,
      // Labelled as retrieved, untrusted context. The orchestrator must be
      // able to tell the difference between what the user said and what a
      // document said — they are not equally trustworthy.
      passages: input.passages ?? [],
      lookups: input.lookups ?? [],
      thread: input.thread ?? [],
    },
    extensions: [],
    referenceTaskIds: [],
  };
}

/**
 * How long a turn may take before it is reported as failed.
 *
 * There was no bound at all. A planning call that never returned left the
 * browser waiting indefinitely with the microphone open — and on a phone that
 * is indistinguishable from the product being broken, because there is nothing
 * to look at while it happens.
 *
 * Generous rather than tight: a genuine plan that consults documents can take
 * many seconds, and cutting a working turn short would be a worse bug than the
 * one this fixes.
 */
const TURN_TIMEOUT_MS = 45_000;

export async function runTurn(input: TurnInput): Promise<TurnResponse> {
  const client = await orchestratorClient();

  const result = await Promise.race([
    client.sendMessage({
      tenant: "",
      message: buildMessage(input),
      configuration: undefined,
      metadata: undefined,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("the planner did not answer in time")),
        TURN_TIMEOUT_MS,
      ),
    ),
  ]);

  // sendMessage returns Message | Task. A bare Message means the agent replied
  // without opening a task, which this agent never does — treat it as a fault
  // rather than quietly returning an empty plan.
  if (!("status" in result) || !result.status) {
    throw new Error("orchestrator returned no task status");
  }

  const task = result as Task;
  // Narrowed once: every branch below reads it, and the SDK types it optional.
  const status = task.status;
  if (!status) throw new Error("orchestrator returned no task status");

  const artifactParts = (task.artifacts ?? []).flatMap((artifact) => artifact.parts ?? []);
  const payloads = dataPayloads(artifactParts);
  const trace = (payloads.find((p) => Array.isArray(p.trace))?.trace ?? []) as string[];

  if (status.state === TaskState.TASK_STATE_INPUT_REQUIRED) {
    // Two different reasons share this state. The artifact says which: a
    // confirmation carries a summary of what would happen, a clarification
    // carries a question about what was meant.
    const confirmation = payloads.find((p) => typeof p.summary === "string");
    if (confirmation) {
      return TurnResponseSchema.parse({
        decision: "confirm",
        confirm: {
          summary: confirmation.summary as string,
          options: (confirmation.options as string[]) ?? [],
          actions: (confirmation.actions as unknown[]) ?? [],
        },
        // The plan travels with it: nobody can agree to something unseen.
        plan: stepsOf(payloads),
        trace,
        citations: citationsOf(payloads),
      });
    }

    const clarification = payloads.find((p) => typeof p.question === "string");
    const spoken = status.message ? textOf(status.message.parts ?? []) : undefined;

    return TurnResponseSchema.parse({
      decision: "clarify",
      clarify: {
        question:
          (clarification?.question as string) ?? spoken ?? "Could you say a little more?",
        options: (clarification?.options as string[]) ?? [],
      },
      plan: [],
      trace,
    });
  }

  if (status.state === TaskState.TASK_STATE_COMPLETED) {
    const closing = payloads.find((p) => typeof p.note === "string");
    return TurnResponseSchema.parse({
      decision: "plan",
      plan: stepsOf(payloads),
      note: (closing?.note as string) ?? "",
      trace,
      citations: citationsOf(payloads),
    });
  }

  throw new Error(`orchestrator task ended in state ${status.state}`);
}

/**
 * The same turn, relayed as it happens.
 *
 * This is not a second implementation of the turn — it is the same agent call
 * with `sendMessageStream` instead of `sendMessage`, and the orchestrator emits
 * identical events either way. What differs is only when the caller sees them.
 *
 *   TaskStatusUpdateEvent (WORKING)  ->  trace
 *   TaskArtifactUpdateEvent          ->  step
 *   TASK_STATE_INPUT_REQUIRED        ->  clarify
 *   TASK_STATE_COMPLETED             ->  done
 *   TASK_STATE_FAILED / REJECTED     ->  error
 *
 * Errors are yielded in-band rather than thrown: by the time one can happen the
 * HTTP response has already begun with a 200, so there is no status code left
 * to change. A caller must treat `error` as terminal.
 */
export async function* streamTurn(input: TurnInput): AsyncGenerator<TurnEvent> {
  const client = await orchestratorClient();

  // Held back until the gate's verdict arrives: the question is published in the
  // artifact, but it is only a *decision* once the task says INPUT_REQUIRED.
  let pendingClarify: { question: string; options: string[] } | undefined;
  let pendingConfirm:
    | { summary: string; options: string[]; actions: unknown[] }
    | undefined;
  let note = "";
  let citations: Citation[] = [];
  let settled = false;

  for await (const response of client.sendMessageStream({
    tenant: "",
    message: buildMessage(input),
    configuration: undefined,
    metadata: undefined,
  })) {
    const payload = response.payload;
    if (!payload) continue;

    if (payload.$case === "artifactUpdate") {
      const payloads = dataPayloads(payload.value.artifact?.parts ?? []);
      for (const part of payloads) {
        if (part.step && typeof part.step === "object") {
          const step = PlanStepSchema.safeParse({
            ...(part.step as object),
            done: false,
          });
          if (step.success) {
            yield { kind: "step", step: step.data };
          }
        }
        if (typeof part.summary === "string") {
          pendingConfirm = {
            summary: part.summary,
            options: Array.isArray(part.options) ? (part.options as string[]) : [],
            actions: Array.isArray(part.actions) ? (part.actions as unknown[]) : [],
          };
        }
        if (typeof part.question === "string") {
          pendingClarify = {
            question: part.question,
            options: Array.isArray(part.options) ? (part.options as string[]) : [],
          };
        }
        if (typeof part.note === "string") note = part.note;
        if (Array.isArray(part.citations)) {
          citations = citationsOf([part]);
        }
      }
      continue;
    }

    if (payload.$case !== "statusUpdate") continue;
    const status = payload.value.status;
    if (!status) continue;

    switch (status.state) {
      case TaskState.TASK_STATE_WORKING: {
        const text = status.message ? textOf(status.message.parts ?? []) : undefined;
        if (text) yield { kind: "trace", text };
        break;
      }
      case TaskState.TASK_STATE_INPUT_REQUIRED: {
        const spoken = status.message ? textOf(status.message.parts ?? []) : undefined;
        // Confirmation first: a turn that produced a plan is never also asking
        // a question about what was meant.
        if (pendingConfirm) {
          for (const c of citations) {
            yield { kind: "citation", ...c };
          }
          yield {
            kind: "confirm",
            summary: pendingConfirm.summary || spoken || "Should I go ahead?",
            options: pendingConfirm.options,
            actions: pendingConfirm.actions as never,
          };
        } else {
          yield {
            kind: "clarify",
            question: pendingClarify?.question ?? spoken ?? "Could you say a little more?",
            options: pendingClarify?.options ?? [],
          };
        }
        settled = true;
        break;
      }
      case TaskState.TASK_STATE_COMPLETED: {
        for (const c of citations) {
          yield { kind: "citation", ...c };
        }
        yield { kind: "done", note, citations };
        settled = true;
        break;
      }
      case TaskState.TASK_STATE_FAILED:
      case TaskState.TASK_STATE_REJECTED:
      case TaskState.TASK_STATE_CANCELED: {
        const spoken = status.message ? textOf(status.message.parts ?? []) : undefined;
        yield { kind: "error", message: spoken ?? "The planner could not finish this turn." };
        settled = true;
        break;
      }
      default:
        break;
    }
  }

  if (!settled) {
    // The stream ended without a terminal state — a dropped connection, or an
    // agent that stopped talking. Saying so beats a plan panel that waits
    // forever for a step that is not coming.
    yield { kind: "error", message: "The connection to the planner ended early." };
  }
}
