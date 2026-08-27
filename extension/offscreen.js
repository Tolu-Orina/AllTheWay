/**
 * Where the meeting audio actually lives.
 *
 * A hidden document, because a MediaStream cannot survive in an MV3 service
 * worker — Chrome terminates those whenever it likes, and a ninety-minute
 * meeting gives it plenty of opportunity.
 *
 * ## The passthrough is not optional
 *
 * Capturing a tab redirects its audio into the capture graph. Connect nothing
 * to the destination and the user hears **silence for the whole meeting** while
 * the recording works perfectly — the single most damaging bug this file can
 * have, because it is invisible to the person who wrote it and total for the
 * person in the call.
 *
 * So the source is wired to the speakers first, and to the encoder second.
 *
 * ## 16 kHz, using the same worklet as voice
 *
 * `pcm-capture.js` is copied from the web app rather than reimplemented. It is
 * the capture half of ADR 0006 and already converts whatever the device runs at
 * into the 16 kHz s16le frames the Live API expects. Two resamplers would drift.
 */

const SOCKET_PATH = "/api/meetings/capture";

let context = null;
let socket = null;
let stream = null;
let node = null;

/**
 * Where the gateway is.
 *
 * Read from the token the web app handed over rather than hardcoded: the
 * extension is loaded unpacked during development and force-installed in
 * production, and a baked-in host would be wrong in one of those.
 */
function socketUrl(origin) {
  const base = origin.replace(/^http/, "ws").replace(/\/$/, "");
  return `${base}${SOCKET_PATH}`;
}

async function start({ streamId, token, meetingId, origin, gateway }) {
  if (socket) return { ok: false, reason: "Already recording." };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
  } catch (error) {
    return { ok: false, reason: `Could not capture this tab (${error.name}).` };
  }

  context = new AudioContext({ sampleRate: 48000 });
  const source = context.createMediaStreamSource(stream);

  // FIRST: give the user their audio back. Everything else is secondary to the
  // person actually being in the meeting.
  source.connect(context.destination);

  try {
    await context.audioWorklet.addModule("worklets/pcm-capture.js");
  } catch (error) {
    await stop();
    return { ok: false, reason: "Could not load the audio processor." };
  }

  socket = new WebSocket(socketUrl(gateway));
  socket.binaryType = "arraybuffer";

  const opened = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(true);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
  });

  if (!opened) {
    await stop();
    return { ok: false, reason: "Could not reach AllTheWay." };
  }

  // The first frame authenticates, exactly as the voice relay does. Sending
  // audio before this would be sending a meeting to an unauthenticated socket.
  socket.send(
    JSON.stringify({
      auth: { token, meetingId, title: origin },
    }),
  );

  node = new AudioWorkletNode(context, "pcm-capture");
  node.port.onmessage = (event) => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    // The worklet emits 20ms of s16le. Base64 because the relay's frame format
    // is JSON, and mixing binary and JSON frames on one socket is how a parser
    // ends up guessing.
    const bytes = new Uint8Array(event.data);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    socket.send(JSON.stringify({ pcm: btoa(binary) }));
  };

  source.connect(node);

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    // Forwarded to the side panel rather than handled here: this document has
    // no UI and exists only to hold the stream.
    if (Array.isArray(message?.insights) && message.insights.length > 0) {
      chrome.runtime.sendMessage({ type: "insights", insights: message.insights });
    }
  };

  socket.onclose = () => {
    void stop();
    chrome.runtime.sendMessage({ type: "ended" });
  };

  // A tab that closes ends its stream. Reported rather than left as a socket
  // that quietly stops carrying anything.
  stream.getAudioTracks()[0]?.addEventListener("ended", () => {
    void stop();
    chrome.runtime.sendMessage({ type: "ended" });
  });

  return { ok: true };
}

async function stop() {
  try {
    node?.disconnect();
    node = null;

    stream?.getTracks().forEach((track) => track.stop());
    stream = null;

    if (socket && socket.readyState === WebSocket.OPEN) {
      // Says the meeting ended rather than just dropping the socket, so the
      // server can close the transcription session cleanly instead of treating
      // it as a connection it should wait to resume.
      socket.send(JSON.stringify({ end: true }));
    }
    socket?.close();
    socket = null;

    await context?.close();
    context = null;
  } catch {
    // Teardown is best-effort by nature: something already gone is not a fault.
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target !== "offscreen") return false;

  if (message.type === "start") {
    void start(message).then(respond);
    return true;
  }
  if (message.type === "stop") {
    void stop().then(respond);
    return true;
  }
  if (message.type === "insights-now") {
    // Asked for by the panel. Sent only if a session is open — there is nothing
    // to reason about otherwise.
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ insights: "now" }));
    }
    respond({ ok: socket?.readyState === WebSocket.OPEN });
    return true;
  }
  return false;
});
