// Throwaway: does the setup message this repo sends actually open a Vertex Live
// session, at the location and model the deployed service is configured with?
import { GoogleAuth } from "google-auth-library";
import WebSocket from "ws";

const PROJECT = process.env.P ?? "alltheway-rinegan";
const LOCATION = process.env.LOC ?? "global";
const MODEL = process.env.M ?? "gemini-live-2.5-flash-native-audio";

const host =
  LOCATION === "global"
    ? "aiplatform.googleapis.com"
    : `${LOCATION}-aiplatform.googleapis.com`;
const url = `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
const modelResource = `projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}`;

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.getClient();
const got = await client.getAccessToken();
const token = typeof got === "string" ? got : got?.token;

console.log(`location=${LOCATION} model=${MODEL}`);
console.log(`url=${url}`);

const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
const done = (code, msg) => {
  console.log(msg);
  try {
    ws.close();
  } catch {}
  process.exit(code);
};

const timer = setTimeout(() => done(1, "RESULT: timeout, no setupComplete"), 15_000);

ws.on("open", () => {
  console.log("socket open, sending setup");
  ws.send(
    JSON.stringify({
      setup: {
        model: modelResource,
        generationConfig: { responseModalities: ["AUDIO"] },
        systemInstruction: { parts: [{ text: "test" }] },
        sessionResumption: { handle: null },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  );
});

ws.on("message", (data) => {
  const text = String(data);
  console.log("<-", text.slice(0, 400));
  if (/setupComplete|setup_complete/.test(text)) {
    clearTimeout(timer);
    done(0, "RESULT: setupComplete — the session opened");
  }
});

ws.on("error", (e) => {
  clearTimeout(timer);
  done(1, `RESULT: error — ${e.message}`);
});

ws.on("close", (code, reason) => {
  clearTimeout(timer);
  done(1, `RESULT: closed ${code} ${reason?.toString().slice(0, 300)}`);
});
