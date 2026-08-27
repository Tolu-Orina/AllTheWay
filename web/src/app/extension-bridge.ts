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
 */

const REQUEST = "alltheway:token-request";
const RESPONSE = "alltheway:token";

export function serveExtensionToken(): () => void {
  const onMessage = async (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if ((event.data as { type?: string } | null)?.type !== REQUEST) return;

    const user = firebaseAuth.currentUser;
    if (!user) {
      // Silence rather than an error: not being signed in yet is the ordinary
      // case on first load, and the extension asks again after sign-in.
      return;
    }

    let token: string;
    try {
      token = await user.getIdToken();
    } catch {
      return;
    }

    window.postMessage(
      {
        type: RESPONSE,
        token,
        // Where the extension should open its capture socket. The same origin
        // the voice socket uses — Firebase Hosting cannot carry a WebSocket
        // upgrade, so this is the Cloud Run hostname rather than the site's.
        gateway: import.meta.env.VITE_STREAM_ORIGIN ?? window.location.origin,
      },
      window.location.origin,
    );
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/**
 * Tell the extension a sign-in just happened, so it can ask again.
 *
 * Without this the extension would hold "not signed in" until the user reloaded
 * the page — and the moment they most want to start recording is right after
 * signing in.
 */
export function announceSignIn(): void {
  window.dispatchEvent(new Event("alltheway:signed-in"));
}
