import { onAuthStateChanged } from "firebase/auth";

import { firebaseAuth } from "@/auth/firebase";

/**
 * The web app's half of the handshake with the meeting-notes extension.
 *
 * The extension captures the meeting tab and needs to reach the gateway as this
 * user. It cannot read the app's storage — a content script and the page share
 * a DOM, not a JavaScript context — so the page hands it a token when asked.
 *
 * ## The page answers; it is never read
 *
 * The extension posts a request and this replies. That ordering matters: it
 * means the app decides whether to answer, can stop answering, and can refuse
 * when nobody is signed in. A content script that scraped a token out of the
 * page would work equally well and give the app no say at all.
 *
 * ## What is handed over
 *
 * A Firebase ID token, which expires within the hour, and the gateway origin.
 * Deliberately **not** a refresh token: an extension holding one could mint
 * credentials indefinitely, whereas this one has to come back to a signed-in
 * page. That is the property that makes handing anything over acceptable.
 *
 * ## Same-origin only
 *
 * Both the listener and the reply are pinned to this origin. An embedded frame
 * from somewhere else must not be able to ask, and the reply must not be
 * readable by one.
 *
 * ## The page pushes; it does not only wait to be asked
 *
 * The content script asks once at `document_idle`. React's listener used to
 * mount later, on `/app` only, so a signed-in user still looked signed-out to
 * the extension. The page now pushes whenever Auth says someone is in, and
 * the listener lives for the whole app (including `/login`), not only the shell.
 *
 * `reply()` must never dispatch `alltheway:signed-in`. The content script
 * used to treat that event as "ask again from scratch". Combined with a reply
 * that announced on every answer, visiting the site with the extension loaded
 * became an unbounded postMessage / getIdToken loop that froze the browser
 * and the machine. The signed-in event is a one-shot wake-up when Auth
 * actually becomes signed in, not part of the reply.
 */

const REQUEST = "alltheway:token-request";
const RESPONSE = "alltheway:token";
const SIGNED_IN = "alltheway:signed-in";

/**
 * The Cloud Run origin the extension must open its capture socket against.
 *
 * Empty on purpose when the build has no `VITE_STREAM_ORIGIN`: falling back to
 * `window.location.origin` (Firebase Hosting) produces a WebSocket that never
 * upgrades. The extension then sits on a 10s timeout and reports nothing
 * useful. Better to omit the gateway and keep a working one than to overwrite
 * it with a hostname that cannot carry the socket.
 */
function gatewayOrigin(): string {
  const baked = import.meta.env.VITE_STREAM_ORIGIN;
  return typeof baked === "string" ? baked.trim() : "";
}

function announceSignIn(): void {
  window.dispatchEvent(new Event(SIGNED_IN));
}

let replyInFlight = false;
let lastReplyAt = 0;

async function reply(): Promise<void> {
  if (replyInFlight) return;
  replyInFlight = true;
  try {
    const user = firebaseAuth.currentUser;
    if (!user) return;
    if (Date.now() - lastReplyAt < 400) return;

    let token: string;
    try {
      token = await user.getIdToken(false);
    } catch {
      return;
    }

    const gateway = gatewayOrigin();
    window.postMessage(
      {
        type: RESPONSE,
        token,
        ...(gateway ? { gateway } : {}),
      },
      window.location.origin,
    );
    lastReplyAt = Date.now();
  } finally {
    replyInFlight = false;
  }
}

export function serveExtensionToken(): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if ((event.data as { type?: string } | null)?.type !== REQUEST) return;
    void reply();
  };

  window.addEventListener("message", onMessage);

  let announced = false;
  const unsub = onAuthStateChanged(firebaseAuth, (user) => {
    if (!user) {
      announced = false;
      return;
    }
    void reply();
    if (!announced) {
      announced = true;
      announceSignIn();
    }
  });

  // currentUser is often already set by the time this effect runs (localStorage
  // persistence). Push once so we do not wait for a request that already flew.
  void reply();

  return () => {
    window.removeEventListener("message", onMessage);
    unsub();
  };
}
