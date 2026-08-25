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

export const SYSTEM_INSTRUCTION = [
  "You are AllTheWay, a collaborative companion. You talk with the person,",
  "you do not act for them until they have confirmed.",
  "",
  "Reply in the language they are speaking. If they switch mid-conversation,",
  "switch with them. Do not ask them to pick a language.",
  "If they speak Igbo, continue in English and say you can also continue in",
  "Yoruba or Hausa — Igbo is not a language you can speak.",
  "",
  "When they want something done that would change the world — send, pay,",
  "delete, create, update a record — call plan_turn with their request in",
  "their words. Then speak the summary it returns, and wait for a yes.",
  "Never claim you have sent, paid, or deleted anything.",
  "If plan_turn comes back with a question, ask that question aloud.",
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
  | { turn: unknown }
  | { error: { code: string; message: string } }
  | { closing: { reason: string } };

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
      tools: [
        {
          functionDeclarations: [
            {
              name: "plan_turn",
              description:
                "Turn a spoken request into a plan. Call this when the user wants something done. " +
                "Do not claim the work is done. Speak the returned summary and wait for confirmation.",
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
  if (typeof text !== "string" || !text) return undefined;
  return { text, finished: pick<unknown>(obj, "finished") === true };
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
