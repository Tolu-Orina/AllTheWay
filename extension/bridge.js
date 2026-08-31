/**
 * The only link between the web app and the extension.
 *
 * ## Why a content script rather than `externally_connectable`
 *
 * `externally_connectable` requires the *page* to know the extension's id, and
 * that id changes between a locally loaded build and a store-published one. The
 * web app would need to know which it is talking to, which means configuration
 * that is wrong in one environment by construction.
 *
 * A content script runs only on the origins named in the manifest, and it
 * already knows its own extension. The page never learns the id at all.
 *
 * ## What crosses, and what does not
 *
 * A short-lived Firebase ID token and the gateway's origin. Nothing else. In
 * particular the extension never receives a refresh token, so a compromised
 * extension cannot mint credentials after the hour is out — it has to come back
 * to a signed-in page, which is exactly the property that makes this safe.
 *
 * The page is asked; it is not scraped. `window.postMessage` with an explicit
 * request means the web app decides whether to answer, and can stop answering.
 *
 * ## Retry, because the first ask is usually too early
 *
 * This script runs at `document_idle`. The page's listener is a React effect.
 * The first `postMessage` used to land before anyone was listening, and the
 * signed-in event it then waited for was never dispatched. `sendMessage` to a
 * sleeping service worker also fails silently (`lastError`). Ask again until
 * a token arrives, and retry the worker hand-off when Chrome drops it.
 *
 * A successful reply must not be treated as a reason to ask again. Clearing
 * `haveToken` on `alltheway:signed-in` used to restart the ask after every
 * answer; if the page also announced on every reply, that loop froze the
 * browser. Signed-in now only wakes an ask that has not yet received a token.
 */

const REQUEST = "alltheway:token-request";
const RESPONSE = "alltheway:token";

let haveToken = false;
let retries = 0;
const MAX_ASKS = 12;

function ask() {
  window.postMessage({ type: REQUEST }, window.location.origin);
}

function deliver(token, gateway, attempt = 0) {
  chrome.runtime.sendMessage(
    {
      type: "token",
      token,
      gateway: typeof gateway === "string" ? gateway : "",
    },
    () => {
      if (chrome.runtime.lastError) {
        if (attempt >= 8) return;
        setTimeout(() => deliver(token, gateway, attempt + 1), 250);
        return;
      }
      haveToken = true;
    },
  );
}

window.addEventListener("message", (event) => {
  // Same-origin only. A message from an embedded frame on another origin must
  // not be able to hand this extension a token of its choosing.
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.type !== RESPONSE) return;

  const token = event.data.token;
  if (typeof token !== "string" || token.length < 20) return;

  // Stop asking the moment a token arrives. Waiting for the worker ack left
  // haveToken false, so a signed-in event could start another ask — and if the
  // page also announced on every reply, that loop froze the machine.
  haveToken = true;
  deliver(token, event.data.gateway);
});

function askUntilHeard() {
  if (haveToken || retries >= MAX_ASKS) return;
  retries += 1;
  ask();
  window.setTimeout(askUntilHeard, 750);
}

askUntilHeard();
window.addEventListener("alltheway:signed-in", () => {
  if (haveToken) return;
  retries = 0;
  askUntilHeard();
});
window.addEventListener("pageshow", () => {
  if (!haveToken) {
    retries = 0;
    askUntilHeard();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !haveToken) ask();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ask-token") return;
  // A long capture outlives one ID token. The service worker asks the page
  // for a fresh one; even if we already handed one over, this must force a
  // new mint rather than replaying the cached hour-old token.
  window.postMessage(
    { type: REQUEST, force: message.force === true },
    window.location.origin,
  );
});
