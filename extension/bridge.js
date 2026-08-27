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
 */

const REQUEST = "alltheway:token-request";
const RESPONSE = "alltheway:token";

function ask() {
  window.postMessage({ type: REQUEST }, window.location.origin);
}

window.addEventListener("message", (event) => {
  // Same-origin only. A message from an embedded frame on another origin must
  // not be able to hand this extension a token of its choosing.
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.type !== RESPONSE) return;

  const token = event.data.token;
  if (typeof token !== "string" || token.length < 20) return;

  chrome.runtime.sendMessage({
    type: "token",
    token,
    // The gateway the app itself is talking to. Read from the page rather than
    // compiled in, so a dev build and a production build each reach their own.
    gateway: typeof event.data.gateway === "string" ? event.data.gateway : "",
  });
});

// Ask once the page has had a chance to sign in, and again when it says it has.
ask();
window.addEventListener("alltheway:signed-in", ask);
