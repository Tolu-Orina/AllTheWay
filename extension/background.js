/**
 * The service worker: it owns the decision to capture, and nothing else.
 *
 * ## Why the audio never touches this file
 *
 * MV3 service workers are terminated whenever Chrome decides they are idle, and
 * a terminated worker takes any MediaStream with it. So capture lives in an
 * offscreen document — a hidden page that Chrome keeps alive for exactly this
 * reason — and this file only starts it, stops it, and remembers which tab is
 * being recorded.
 *
 * ## Why tabCapture and not getDisplayMedia
 *
 * `getDisplayMedia` always opens Chrome's picker, cannot be pre-selected, and
 * needs the user to notice a "share tab audio" checkbox. `chrome.tabCapture`
 * captures a known tab directly after a user gesture, with no dialog. That
 * difference is the whole reason this is an extension rather than a button in
 * the web app.
 *
 * ## The stream id must be minted here
 *
 * `getMediaStreamId` requires the extension context and a recent user gesture.
 * The offscreen document has neither, so the id is minted here and handed over.
 *
 * ## State lives in session storage, not in this process
 *
 * `capturing` used to be a variable. Chrome kills this worker; the offscreen
 * document keeps recording; the popup then claimed nothing was happening.
 * Session storage survives the worker. It does not survive the browser closing,
 * which is the same lifetime as the recording itself.
 */

import { ALLTHEWAY_URL_PATTERNS, ensureGatewayAccess, findMeetingTab } from "./meeting-tab.js";

const OFFSCREEN_PATH = "offscreen.html";

/** Where the token from the web app is kept. Session storage, never synced. */
const TOKEN_KEY = "idToken";
/** The gateway origin, learned from the page rather than compiled in. */
const GATEWAY_KEY = "gateway";
const CAPTURE_KEY = "capturing";
const LINES_KEY = "transcriptLines";
const INSIGHTS_KEY = "insightCards";

/** ID tokens last about an hour. Ask for a new one before that, not after. */
const TOKEN_REFRESH_MS = 40 * 60_000;

let capturing = null; // { tabId, meetingId, startedAt }
let refreshTimer = null;

async function persistCapture(state) {
  capturing = state;
  if (state) {
    await chrome.storage.session.set({ [CAPTURE_KEY]: state });
    return;
  }
  await chrome.storage.session.remove(CAPTURE_KEY);
}

async function restoreCapture() {
  const { [CAPTURE_KEY]: stored } = await chrome.storage.session.get(CAPTURE_KEY);
  if (!stored) {
    capturing = null;
    return;
  }

  const hasOffscreen = await chrome.offscreen.hasDocument?.();
  if (!hasOffscreen) {
    // The worker restarted and the offscreen document is gone: we are not
    // recording, whatever session storage still says.
    capturing = null;
    await chrome.storage.session.remove(CAPTURE_KEY);
    await chrome.action.setBadgeText({ text: "" });
    stopTokenRefreshLoop();
    return;
  }

  capturing = stored;
  await chrome.action.setBadgeText({ text: "REC" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
  startTokenRefreshLoop();
}

void restoreCapture();

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    // USER_MEDIA is the honest reason: this document exists to hold a
    // MediaStream that a service worker cannot.
    reasons: ["USER_MEDIA"],
    justification:
      "Holds the captured meeting audio and streams it for transcription. A service worker cannot hold a MediaStream.",
  });
}

function startTokenRefreshLoop() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => void askPagesForFreshToken(), TOKEN_REFRESH_MS);
  void askPagesForFreshToken();
}

function stopTokenRefreshLoop() {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

async function askPagesForFreshToken() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: ALLTHEWAY_URL_PATTERNS });
  } catch {
    tabs = [];
  }

  for (const tab of tabs) {
    if (typeof tab.id !== "number") continue;
    chrome.tabs.sendMessage(tab.id, { type: "ask-token", force: true }, () => {
      // The AllTheWay tab may have no content script (not signed in, or a
      // page we do not inject on). Keep capturing until verify fails.
      void chrome.runtime.lastError;
    });
  }
}

async function startCapture({ tabId, meetingId, disclosed }) {
  if (disclosed !== true) {
    // Refused here as well as in the panel. The checkbox is a convenience;
    // this is the client-side boundary, and a message crafted without the flag
    // must not start a recording nobody in the room was told about. The
    // gateway refuses again.
    return { ok: false, reason: "Nobody has been told about this recording yet." };
  }

  const { [TOKEN_KEY]: token, [GATEWAY_KEY]: gateway } = await chrome.storage.session.get([
    TOKEN_KEY,
    GATEWAY_KEY,
  ]);
  if (!token) {
    return {
      ok: false,
      reason: "Open AllTheWay in a tab and sign in, then try again.",
      needsSignIn: true,
    };
  }
  if (!gateway) {
    return {
      ok: false,
      reason: "Could not reach AllTheWay. Reload the AllTheWay tab, then try again.",
    };
  }

  // Asked here so a Start click is still a user gesture. The panel also asks
  // first; this is the fallback if that call lost the gesture.
  if (!(await ensureGatewayAccess(gateway))) {
    return {
      ok: false,
      reason: "Allow AllTheWay to reach the notes server, then try again.",
    };
  }

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).catch(() => null);
  if (!streamId) {
    return { ok: false, reason: "Could not capture this meeting tab." };
  }

  await ensureOffscreen();

  const tab = await chrome.tabs.get(tabId);
  const started = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    token,
    meetingId,
    gateway,
    disclosed: true,
    origin: tab.title ?? "Meeting",
    meetUrl: tab.url ?? "",
  });

  if (started?.ok) {
    await persistCapture({ tabId, meetingId, startedAt: Date.now() });
    await chrome.storage.session.set({ [LINES_KEY]: [], [INSIGHTS_KEY]: [] });
    startTokenRefreshLoop();
    const { presenting } = await chrome.storage.session.get("presenting");
    // While they present, the side panel is the room's screen. Insights stay
    // on the phone. Capture still runs.
    if (!presenting) {
      try {
        await chrome.sidePanel.open({ tabId });
      } catch {
        // Older Chrome, or a window that refuses. Capture still works.
      }
    }
    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
  }
  return started ?? { ok: false, reason: "Capture did not start." };
}

async function stopCapture() {
  try {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  } catch {
    // The offscreen document may already be gone. Stopping something that has
    // stopped is not an error worth surfacing.
  }
  await persistCapture(null);
  stopTokenRefreshLoop();
  await chrome.action.setBadgeText({ text: "" });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target === "offscreen") return false; // not ours

  if (message?.type === "start") {
    void startCapture(message)
      .then(respond)
      .catch(() => respond({ ok: false, reason: "Capture did not start." }));
    return true;
  }
  if (message?.type === "stop") {
    void stopCapture()
      .then(respond)
      .catch(() => respond({ ok: true }));
    return true;
  }
  if (message?.type === "status") {
    void (async () => {
      if (!capturing) await restoreCapture();
      const { [TOKEN_KEY]: token } = await chrome.storage.session.get(TOKEN_KEY);
      respond({ capturing, signedIn: Boolean(token) });
    })();
    return true;
  }
  if (message?.type === "pick-meeting-tab") {
    void findMeetingTab().then((tab) =>
      respond(
        tab?.id
          ? { ok: true, tabId: tab.id, title: tab.title ?? "Meeting", url: tab.url ?? "" }
          : { ok: false },
      ),
    );
    return true;
  }
  if (message?.type === "token") {
    // Forwarded by the content script from the web app. Session storage, so it
    // is gone when the browser closes and never written to disk or synced.
    void chrome.storage.session
      .get([TOKEN_KEY, GATEWAY_KEY])
      .then((current) => {
        if (
          current[TOKEN_KEY] === message.token &&
          (!message.gateway || current[GATEWAY_KEY] === message.gateway)
        ) {
          respond({ ok: true });
          return;
        }
        return chrome.storage.session
          .set({
            [TOKEN_KEY]: message.token,
            // Only overwritten when the page actually supplied one, so a page that
            // answers without it cannot erase a working gateway.
            ...(message.gateway ? { [GATEWAY_KEY]: message.gateway } : {}),
          })
          .then(() => respond({ ok: true }));
      });
    return true;
  }
  if (message?.type === "insights-now") {
    void chrome.runtime
      .sendMessage({ target: "offscreen", type: "insights-now" })
      .then(respond)
      .catch(() => respond({ ok: false }));
    return true;
  }
  if (message?.type === "ended") {
    // The offscreen document reporting that capture stopped on its own — the
    // tab closed, or the stream ended. The badge must not keep claiming to
    // record something that is no longer being recorded.
    void persistCapture(null);
    stopTokenRefreshLoop();
    void chrome.action.setBadgeText({ text: "" });
    return false;
  }
  if (message?.type === "meet-caption") {
    if (
      capturing &&
      typeof message.speaker === "string" &&
      typeof message.text === "string"
    ) {
      void chrome.runtime.sendMessage({
        target: "offscreen",
        type: "caption",
        speaker: message.speaker,
        text: message.text,
      }, () => {
        void chrome.runtime.lastError;
      });
    }
    return false;
  }
  if (message?.type === "meet-presenting") {
    void chrome.storage.session.set({ presenting: message.presenting === true });
    return false;
  }
  return false;
});

// A captured tab that closes ends the recording. Chrome does not tell the
// offscreen document directly, so it is watched here.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (capturing?.tabId === tabId) void stopCapture();
});
