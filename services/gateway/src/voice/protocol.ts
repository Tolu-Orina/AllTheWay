import { SESSION_TOOLS, READ_TOOLS } from "./tools.js";
/**
 * The Live API wire, and our thinner wire to the browser.
 *
 * Vertex's BidiGenerateContent JSON is camelCase in the published object set
 * (`realtimeInput`, `setupComplete`) and snake_case in several SDK snippets.
 * We send camelCase (the protocol table) and read both, because a field we
 * miss is silent audio, not an error.
 *
 * The browser never sees this shape. It speaks the control protocol in
 * `BrowserMessage` / `RelayMessage` so a Vertex rename cannot break the app,
 * and so a stolen browser socket is not a stolen Vertex session.
 */

export const INPUT_HZ = 16_000;
export const OUTPUT_HZ = 24_000;
export const PCM_MIME_IN = `audio/pcm;rate=${INPUT_HZ}`;
export const PCM_MIME_OUT = `audio/pcm;rate=${OUTPUT_HZ}`;

export const AUTH_TIMEOUT_MS = 4_000;
export const VOICE_PATH = "/api/voice/live";

/** Vertex Live native audio. Pinned, never latest. No language_code. */
export const DEFAULT_LIVE_MODEL = "gemini-live-2.5-flash-native-audio";

/**
 * What the live model is told before anyone speaks.
 *
 * The language half is load-bearing and deliberately specific. The setup sends
 * no `language_code` on purpose -- pinning one would lock the session to a
 * single language and make every rule below unreachable, which is why
 * `voice.test.ts` asserts that field is absent.
 *
 * Written for people who do not speak one language at a time. Code-mixing is
 * ordinary speech in most of the world, and a companion that answers a mixed
 * sentence by tidying it into one language is correcting the user.
 */
export const SYSTEM_INSTRUCTION = [
  "You are AllTheWay, a collaborative companion. You talk with the person;",
  "you do not act for them until they have confirmed.",
  "",
  "# Language",
  "",
  "Speak the language they speak. Decide from what they have just said - not",
  "from what they said earlier, and never from their name, their accent, or",
  "where they are.",
  "",
  "Switch the moment they switch, including mid-conversation and mid-sentence.",
  "Do it silently. Never announce a switch, never remark on their language,",
  "never ask them to choose one, and never apologise for the language you used",
  "a moment ago. Switching is not a topic of conversation; it is just what you",
  "do.",
  "",
  "Many people mix languages inside one sentence - English with Yoruba, with",
  "Spanish, with Pidgin, with French. That is fluent speech, not an error.",
  "Mirror the mix at roughly the level they use it. Do not tidy them into a",
  "single language, and do not translate back into the main language the words",
  "they deliberately chose to say in another.",
  "",
  "One borrowed word is not a switch. A greeting or a single loanword inside an",
  "otherwise English sentence leaves you in English. Follow the language the",
  "sentence is actually built in, not the most recent foreign word in it.",
  "",
  "Match how they speak, not only what they speak. Keep their level of",
  "formality, and where a language separates formal from familiar address -",
  "vous and tu, usted and tu, nin and ni - use the form they used with you.",
  "",
  "Leave names, places, product names and anything they quoted exactly as they",
  "said it. Say numbers, dates, times and amounts the way that language says",
  "them, rather than translating the English phrasing word for word.",
  "",
  "If they speak a language you cannot speak well, say so plainly, in the",
  "language nearest theirs that you do speak, and offer what you have. For",
  "Igbo: continue in English and say you can also continue in Yoruba or Hausa.",
  "Bad output in someone's language is worse than admitting you do not have it.",
  "",
  "# Looking things up",
  "",
  "You can see some things for yourself. Use those tools rather than guessing,",
  "and rather than asking the person for what you could look up. If they ask",
  "what is on today, what is waiting, what a document says, or what was agreed",
  "in a meeting, go and look before you answer.",
  "",
  "Say what you found in your own words, in their language. Do not read the",
  "result out field by field. If a tool tells you it cannot see something --",
  "an account that is not connected -- say that plainly and say what would fix",
  "it. Never invent a meeting, a time, or a document you did not get back.",
  "",
  "Scheduled meetings live on the calendar. Meetings you took notes in are a",
  "different thing; do not answer one with the other.",
  "",
  "# Doing things",
  "",
  "When they want something done that would change the world - send, pay,",
  "delete, create, update a record - call plan_turn with their request in their",
  "own words, in the language they used. Do not translate the request first:",
  "their wording is what the plan is checked against.",
  "",
  "Put everything they have already told you into that request - the title, the",
  "day, the time and timezone they named, and every email address they spoke.",
  "If they said UK time, say so. If they named people to invite, include the",
  "addresses. Do not wait for a type-ahead you cannot see; you have no contacts",
  "directory. Use the addresses they said.",
  "",
  "plan_turn answers you in English. Do not read that English aloud. Say what",
  "it means in the language you are speaking with them, in your own voice. The",
  "same holds for any question it returns - ask that question aloud, in their",
  "language, not in English.",
  "",
  "If it returns a confirm, speak the summary and wait. Do not invent your own",
  "shall-I before plan_turn has returned one: that yes has nothing to execute.",
  "",
  "If that confirm is composing an email, speak the subject and a short version",
  "of the body, then wait. Never say you cannot show the email. The overlay form",
  "is the full text they can edit. Yes or Save draft saves a Gmail draft; it does not send.",
  "Sending waits for a later turn that names an existing draft.",
  "If the confirm is a calendar event, speak the title and when, then wait.",
  "",
  "When they then say yes - yeah, go ahead, yes please, do it, ok - call",
  "they_said_yes immediately. Do not call plan_turn with their yes. Do not ask",
  "what they would like you to go ahead with. After they_said_yes returns, tell",
  "them what happened in their language. If a step failed, say so. Never claim " +
  "you have sent, paid, created, or deleted anything this tool did not report.",
  "",
  "If they say no, stop, or cancel, call they_said_no. Nothing runs.",
  "",
  "# Leaving",
  "",
  "When they are ending this conversation itself - goodbye, bye, that's all,",
  "you can stop, I'm done talking - speak a short farewell in their language,",
  "then call end_this_conversation. Do not wait for a yes.",
  "",
  "Do not call it when they want you to stop a task, a reminder, an email, or",
  "anything they asked you to do. That is plan_turn.",
  "",
  "Leaving is not a yes. Do not treat goodbye as confirmation of a pending plan.",
  "",
  "# Starting a session",
  "",
  "When you join, greet them briefly in the language they first speak - one or",
  "two words, nothing elaborate. Do not recap what was said before, do not",
  "assume a task is still in progress, and do not ask if they want to continue",
  "anything. Each session starts fresh: wait for them to tell you what they want.",
  "",
  "If they say hello, respond naturally. If they jump straight to a question or",
  "a task, skip the greeting and just answer or act.",
].join("\n");

export type AuthMessage = {
  auth: {
    token: string;
    sessionId: string;
    resumeHandle?: string;
  };
};

export type BrowserPcm = { pcm: string };

export type BrowserMessage = AuthMessage | BrowserPcm | { hangup: true };

export type RelayReady = {
  ready: {
    model: string;
    inputHz: number;
    outputHz: number;
    fake?: true;
  };
};

export type RelayMessage =
  | RelayReady
  | { pcm: string }
  | { interrupted: true }
  | { transcript: { side: "user" | "model"; text: string; finished: boolean } }
  | { resumeHandle: string }
  | { turn: unknown }
  | { error: { code: string; message: string } }
  | { closing: { reason: string } };

/**
 * Live transcriptions are streamed, not replaced.
 *
 * Google's own Live clients concatenate each `text` onto the current
 * utterance (`inputTranscript += inputText`). We used to overwrite, so a
 * phone only ever showed the last fragment — "partial conversation".
 *
 * Some payloads are refinements of the whole hypothesis ("I'll" → "I'll
 * send") rather than a delta. Prefer the longer string when one is a prefix
 * of the other; otherwise append, collapsing overlap.
 */
export function foldTranscript(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return incoming;
  if (incoming.startsWith(current)) return incoming;
  if (current.startsWith(incoming)) return current;
  let overlap = 0;
  const limit = Math.min(current.length, incoming.length);
  for (let n = limit; n > 0; n--) {
    if (current.slice(current.length - n) === incoming.slice(0, n)) {
      overlap = n;
      break;
    }
  }
  return current + incoming.slice(overlap);
}

export class TranscriptAccumulator {
  private user = "";
  private model = "";

  push(
    side: "user" | "model",
    text: string,
    finished: boolean,
  ): { text: string; finished: boolean } {
    const prev = side === "user" ? this.user : this.model;
    const next = foldTranscript(prev, text);
    if (finished) {
      if (side === "user") this.user = "";
      else this.model = "";
    } else if (side === "user") this.user = next;
    else this.model = next;
    return { text: next, finished };
  }

  flush(side?: "user" | "model"): { side: "user" | "model"; text: string }[] {
    const out: { side: "user" | "model"; text: string }[] = [];
    if (side !== "model" && this.user) {
      out.push({ side: "user", text: this.user });
      this.user = "";
    }
    if (side !== "user" && this.model) {
      out.push({ side: "model", text: this.model });
      this.model = "";
    }
    return out;
  }
}

export function isAuthMessage(value: unknown): value is AuthMessage {
  if (!value || typeof value !== "object") return false;
  const auth = (value as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object") return false;
  const token = (auth as { token?: unknown }).token;
  const sessionId = (auth as { sessionId?: unknown }).sessionId;
  return typeof token === "string" && typeof sessionId === "string" && sessionId.length > 0;
}

export function isPcmMessage(value: unknown): value is BrowserPcm {
  return !!value && typeof value === "object" && typeof (value as { pcm?: unknown }).pcm === "string";
}

export function liveModelResource(projectId: string, location: string, model: string): string {
  return `projects/${projectId}/locations/${location}/publishers/google/models/${model}`;
}

/** `global` is not `{location}-aiplatform`; everywhere else is. */
export function liveWebSocketUrl(location: string): string {
  const host =
    location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
}

export function setupMessage(opts: {
  modelResource: string;
  resumeHandle?: string;
}): Record<string, unknown> {
  return {
    setup: {
      model: opts.modelResource,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },

      // How readily it decides someone is talking to it.
      //
      // Left at the default, it answered whatever the microphone picked up --
      // including the user turning away to speak to somebody else in the room.
      // It cannot tell speakers apart, so every voice in earshot reads as a
      // question addressed to it.
      //
      // Automatic detection stays ON: the alternative is push-to-talk, which
      // makes every ordinary turn cost a button press to fix an occasional
      // problem. What changes is how eager it is. A low start sensitivity waits
      // for speech clearly aimed at it, and a longer silence window stops it
      // interrupting a pause mid-thought.
      //
      // These numbers are a considered starting point, not a measured optimum.
      // If it becomes slow to answer, raise the sensitivity before shortening
      // the silence window -- being cut off mid-sentence is the worse failure.
      // The mute control in the browser is the deliberate escape hatch, and is
      // what a user should reach for when the room is not for it to hear.
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
          endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
          // Audio kept from just before speech is detected, so the first
          // syllable is not clipped off the front of a turn.
          prefixPaddingMs: 300,
          // How long a pause must last before it treats the turn as finished.
          silenceDurationMs: 900,
        },
      },
      tools: [
        {
          // The read tools first, then the planner.
          //
          // Order is not cosmetic: a model choosing a tool reads the list, and
          // putting the thing that answers a question ahead of the thing that
          // makes a plan is how "what's on today" stops becoming a plan about
          // looking at a calendar.
          functionDeclarations: [
            ...READ_TOOLS,
            {
              name: "plan_turn",
              description:
                "Turn a spoken request into a plan. Call this when the user wants something done. " +
                "Do not claim the work is done. Speak the returned summary and wait for confirmation. " +
                "If they are saying yes to a plan you already proposed, call they_said_yes instead.",
              parameters: {
                type: "OBJECT",
                properties: {
                  request: {
                    type: "STRING",
                    description: "What the user asked, in their own words.",
                  },
                },
                required: ["request"],
              },
            },
            // Last: lookups and doing things must win over hanging up.
            ...SESSION_TOOLS,
          ],
        },
      ],
      sessionResumption: { handle: opts.resumeHandle ?? null },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export function realtimePcm(base64: string): Record<string, unknown> {
  return {
    realtimeInput: {
      mediaChunks: [{ mimeType: PCM_MIME_IN, data: base64 }],
    },
  };
}

export function toolResponse(
  id: string,
  name: string,
  payload: unknown,
): Record<string, unknown> {
  return {
    toolResponse: {
      functionResponses: [
        {
          id,
          name,
          response: payload,
        },
      ],
    },
  };
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
}

function pick<T>(obj: Json, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (key in obj) return obj[key] as T;
  }
  return undefined;
}

export type ParsedServer = {
  setupComplete?: boolean;
  interrupted?: boolean;
  turnComplete?: boolean;
  generationComplete?: boolean;
  pcm?: string[];
  userTranscript?: { text: string; finished: boolean };
  modelTranscript?: { text: string; finished: boolean };
  goAway?: boolean;
  resumeHandle?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallCancellations?: string[];
};

function transcription(value: unknown): { text: string; finished: boolean } | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;
  const text = pick<unknown>(obj, "text");
  const finished = pick<unknown>(obj, "finished") === true;
  const str = typeof text === "string" ? text : "";
  // `finished: true` with no new text is "commit what you have". Dropping it
  // left the last utterance stuck as a partial, which is how a conversation
  // looked like it stopped mid-sentence.
  if (!str && !finished) return undefined;
  return { text: str, finished };
}

function inlineAudio(part: unknown): string | undefined {
  const obj = asObject(part);
  if (!obj) return undefined;
  const data = asObject(pick(obj, "inlineData", "inline_data"));
  if (!data) return undefined;
  const mime = pick<unknown>(data, "mimeType", "mime_type");
  const bytes = pick<unknown>(data, "data");
  if (typeof bytes !== "string" || !bytes) return undefined;
  if (typeof mime === "string" && mime.length > 0 && !mime.includes("audio")) return undefined;
  return bytes;
}

export function parseServerMessage(raw: unknown): ParsedServer {
  const obj = asObject(raw);
  if (!obj) return {};

  const out: ParsedServer = {};

  if (pick(obj, "setupComplete", "setup_complete") !== undefined) {
    out.setupComplete = true;
  }

  if (pick(obj, "goAway", "go_away") !== undefined) {
    out.goAway = true;
  }

  const resume = asObject(pick(obj, "sessionResumptionUpdate", "session_resumption_update"));
  if (resume) {
    const handle = pick<unknown>(resume, "newHandle", "new_handle");
    const resumable = pick<unknown>(resume, "resumable");
    if (resumable !== false && typeof handle === "string" && handle) {
      out.resumeHandle = handle;
    }
  }

  const toolCall = asObject(pick(obj, "toolCall", "tool_call"));
  const calls = pick<unknown>(toolCall ?? {}, "functionCalls", "function_calls");
  if (Array.isArray(calls)) {
    out.toolCalls = calls.flatMap((call) => {
      const c = asObject(call);
      if (!c) return [];
      const id = pick<unknown>(c, "id");
      const name = pick<unknown>(c, "name");
      const args = pick<unknown>(c, "args") ?? pick<unknown>(c, "args");
      if (typeof id !== "string" || typeof name !== "string") return [];
      return [{ id, name, args: asObject(args) ?? {} }];
    });
  }

  const cancel = asObject(pick(obj, "toolCallCancellation", "tool_call_cancellation"));
  const ids = pick<unknown>(cancel ?? {}, "ids");
  if (Array.isArray(ids)) {
    out.toolCallCancellations = ids.filter((id): id is string => typeof id === "string");
  }

  const topIn = transcription(pick(obj, "inputTranscription", "input_transcription"));
  const topOut = transcription(pick(obj, "outputTranscription", "output_transcription"));
  if (topIn) out.userTranscript = topIn;
  if (topOut) out.modelTranscript = topOut;

  const server = asObject(pick(obj, "serverContent", "server_content"));
  if (!server) return out;

  if (pick(server, "interrupted") === true) out.interrupted = true;
  if (pick(server, "turnComplete", "turn_complete") === true) out.turnComplete = true;
  if (pick(server, "generationComplete", "generation_complete") === true) {
    out.generationComplete = true;
  }

  const nestedIn = transcription(pick(server, "inputTranscription", "input_transcription"));
  const nestedOut = transcription(pick(server, "outputTranscription", "output_transcription"));
  if (nestedIn) out.userTranscript = nestedIn;
  if (nestedOut) out.modelTranscript = nestedOut;

  const turn = asObject(pick(server, "modelTurn", "model_turn"));
  const parts = pick<unknown>(turn ?? {}, "parts");
  if (Array.isArray(parts)) {
    const pcm = parts.map(inlineAudio).filter((b): b is string => !!b);
    if (pcm.length) out.pcm = pcm;
  }

  return out;
}
