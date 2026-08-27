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
 */

const OFFSCREEN_PATH = "offscreen.html";

/** Where the token from the web app is kept. Session storage, never synced. */
const TOKEN_KEY = "idToken";
/** The gateway origin, learned from the page rather than compiled in. */
const GATEWAY_KEY = "gateway";

let capturing = null; // { tabId, meetingId, startedAt }

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

async function startCapture({ tabId, meetingId, disclosed }) {
  if (!disclosed) {
    // Refused here as well as in the popup. The popup is a convenience; this is
    // the boundary, and a message crafted without the flag must not start a
    // recording nobody in the room was told about.
    return { ok: false, reason: "Nobody has been told about this recording yet." };
  }

  const { [TOKEN_KEY]: token, [GATEWAY_KEY]: gateway } = await chrome.storage.session.get([
    TOKEN_KEY,
    GATEWAY_KEY,
  ]);
  if (!token || !gateway) {
    return {
      ok: false,
      reason: "Open AllTheWay in a tab and sign in, then try again.",
      needsSignIn: true,
    };
  }

  // Minted here, while the user's click is still recent.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });

  await ensureOffscreen();

  const started = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    token,
    meetingId,
    gateway,
    // The tab's own title is the best name available for a meeting the user
    // never named. Better than "Meeting 3".
    origin: (await chrome.tabs.get(tabId)).title ?? "Meeting",
  });

  if (started?.ok) {
    capturing = { tabId, meetingId, startedAt: Date.now() };
    // Opened with the recording, not left for the user to find. An insight
    // panel nobody knows about is a reasoning call nobody reads.
    try {
      await chrome.sidePanel.open({ tabId });
    } catch {
      // Older Chrome, or a window that refuses. Capture still works.
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
  capturing = null;
  await chrome.action.setBadgeText({ text: "" });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target === "offscreen") return false; // not ours

  if (message?.type === "start") {
    void startCapture(message).then(respond);
    return true;
  }
  if (message?.type === "stop") {
    void stopCapture().then(respond);
    return true;
  }
  if (message?.type === "status") {
    void chrome.storage.session.get(TOKEN_KEY).then(({ [TOKEN_KEY]: token }) =>
      respond({ capturing, signedIn: Boolean(token) }),
    );
    return true;
  }
  if (message?.type === "token") {
    // Forwarded by the content script from the web app. Session storage, so it
    // is gone when the browser closes and never written to disk or synced.
    void chrome.storage.session
      .set({
        [TOKEN_KEY]: message.token,
        // Only overwritten when the page actually supplied one, so a page that
        // answers without it cannot erase a working gateway.
        ...(message.gateway ? { [GATEWAY_KEY]: message.gateway } : {}),
      })
      .then(() => respond({ ok: true }));
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
    capturing = null;
    void chrome.action.setBadgeText({ text: "" });
    return false;
  }
  return false;
});

// A captured tab that closes ends the recording. Chrome does not tell the
// offscreen document directly, so it is watched here.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (capturing?.tabId === tabId) void stopCapture();
});
