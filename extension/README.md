# AllTheWay meeting notes — browser extension

Tier 1.5: notes from the meeting you are already in, captured on your own
machine. Nothing joins the call.

## Why this exists

Tier 2 (Meet Media API) needs a Developer Preview enrolment this project does
not have — probed across eight Vertex regions, the method simply is not served
to us. Tier 1 only reads a transcript after the call ends.

A headless-browser bot is the industry's usual workaround, and the manifest
refuses it in §6.2: *"an unannounced participant in someone else's meeting"*.
It is also no longer the easy path — since March 2026 Google Meet flags
notetaker bots as a "potential risk" and denies them unless the host manually
admits them, and Microsoft Teams does the same as of June 2026.

This captures the tab audio the user is already hearing. Nothing joins, nothing
appears in the participant list, and no audio goes to a third party.

## Loading it

    chrome://extensions → Developer mode → Load unpacked → select this folder

Then open AllTheWay in a tab and sign in once. The extension asks the page for a
token; it never reads one out of storage, and it never receives a refresh token.
While a meeting is being captured it asks the signed-in page again before the
hour is out, and the page mints a fresh ID token (`getIdToken(true)`). If that
tab is gone, capture continues until the gateway rejects the expired token.

## Using it

1. Join a Meet, Zoom web, or Teams web meeting as normal.
2. Open the side panel (or the popup) on AllTheWay meeting notes, tick the
   disclosure box, press **Start taking notes**. The extension records the
   meeting tab, not whichever tab happens to be focused.
3. The transcript and Check now live in the side panel. Notes and commitments
   also appear in AllTheWay when the meeting ends.

The disclosure box is unticked every time. The gateway refuses a session without
`disclosed: true` as a boolean — a checkbox in the extension is a courtesy and
the server is the boundary.

`chrome.tabCapture` targets the meeting tab after a click, with no picker. That
is the whole reason this is an extension rather than a button in the web app.

A guest notetaker bot is **not live** and is not shown in the panel. Live notes
are **Notes from this tab**. Until finance signs a join vendor, the server would
answer `vendor_pending` and nothing knocks. It still cannot speak.

## The disclosure box is not a formality

A bot is visible in the participant list, so the platform announces it for you.
This announces nothing, and the obligation moves entirely to the person pressing
the button. In all-party-consent jurisdictions — California and Illinois among
them — recording without telling everyone is unlawful however it is done.

The box is unticked every time the panel or popup opens, deliberately. "I told them" is
true of one meeting; remembering it would silently assert it about the next.
The server refuses a session without it too, because a checkbox in an extension
is a courtesy and the gateway is the boundary.

## Known limits

- **Chromium only**, and **browser tabs only** — a native Zoom or Teams desktop
  client cannot be captured this way. Start looks for a Meet, Zoom web, or
  Teams web tab; if none is open, it refuses rather than recording AllTheWay.
- **Closing the captured tab ends the recording.** Chrome gives no way around
  this; the extension reports it rather than appearing to still record.
- **Switching tabs can drop audio briefly** through background throttling.
  Gaps over two seconds are labelled in the notes rather than silently omitted.
- **90-minute cap**, enforced by the gateway as well as the client. A capture
  that ran because a client forgot to stop is exactly the cost this bounds.

## Publishing

Chrome Web Store enforcement of the 2026 privacy rules began on **1 August
2026**, and this extension records meeting audio and sends it to a server —
which is the most scrutinised category there is. The code side is ready; the
listing side is not, and the remaining work is disclosure rather than
engineering.

### Done

- Icons at 16/32/48/128.
- Required `host_permissions` are AllTheWay itself plus Meet / Zoom web /
  Teams web, so the extension can find the meeting tab without the broad
  `tabs` permission. On Meet it also injects `meet-captions.js` so names
  Meet already shows in captions can label notes. That is disclosed in this
  listing. It does not invent a name, and it does not inject into Zoom or Teams.
- Cloud Run (`https://*.run.app/*`, `wss://*.run.app/*`) and localhost live in
  `optional_host_permissions`. On Start, the extension asks for the **exact**
  origin the signed-in page handed over (`VITE_STREAM_ORIGIN`). The hashed
  Cloud Run hostname is the one that matters: that is what the web build
  bakes, and narrowing to only the deterministic `{service}-{project}.{region}`
  form silently blocks the socket.

### Still required before submitting

1. **A privacy policy at a public, persistent URL** — reachable without logging
   in, carrying an effective date and a working contact address. It must say
   plainly that meeting audio is captured, transmitted for transcription, and
   what is retained.
2. **Privacy Practices declarations** in the dashboard, ticking every data
   category the permissions imply. Audio is the significant one.
3. **A justification per permission.** `tabCapture` is the one that decides the
   review: say that capture is user-initiated per meeting, bound to one tab, and
   gated behind an explicit disclosure the server also enforces.
4. **Listing assets** — screenshots, a category, and a description whose single
   stated purpose matches what the code does. Collecting anything beyond that
   purpose is now a policy violation regardless of disclosure.
5. **A developer account** (one-off fee).
6. **Strip `http://localhost:*/*` from `content_scripts`** for a store listing. It is there so an unpacked build can handshake with a local AllTheWay tab. A published extension should only inject on the production AllTheWay origins.

### Which visibility

**Unlisted** is probably right, and possibly for good. It is still reviewed, but
only people with the link install it — which suits an internal tool and avoids
supporting strangers who record other people's meetings.

**Enterprise force-install** via Workspace admin policy skips the store review
entirely and is the better answer if this stays inside one organisation.

**Public** invites the most scrutiny and the most support burden, for an
audience this does not yet have. Expect two to four weeks of review for
sensitive permissions on a new account.

For a demo, `Load unpacked` needs none of this.

## Transcription

Audio goes to the gateway at `/api/meetings/capture` and from there to
`gemini-3.5-transcribe-live-preview` over the Live API, configured to transcribe
and nothing else — no tools, no automatic activity detection, text-only
responses. Those three together are what stop a model answering the room, which
is FR-C4 enforced by configuration rather than by trusting a prompt.

Verified against the live endpoint: the setup is answered with `setupComplete`.

Three properties of that model shape the implementation:

- **`global` only.** The opposite of the voice relay, which had to be moved
  *off* `global` because the conversation model does not exist there. Reusing
  `env.liveLocation` here would be wrong in exactly the way that variable was
  created to prevent, so transcription has its own.
- **Ten minutes of audio per session.** A meeting is ninety, so sessions rotate
  at eight and a half minutes of *audio sent* — not wall clock, because a muted
  meeting sends nothing. The replacement is confirmed before the old one closes,
  so frames always have somewhere to land.
- **Audio before `setupComplete` is lost**, and can cancel the session outright.
  Frames are buffered until the server confirms, then flushed — otherwise the
  opening seconds of every meeting, where people say what it is about, would
  vanish.

**No speaker diarization on tab audio.** This model does not support it, so notes
render speakers as "Unattributed" unless Meet captions already named the line,
or Meet REST overlay fills the name afterwards. Word-level timestamps are also
unsupported; utterance-level are.

**85+ languages, auto-detected, including switching mid-sentence.** No language
is forced by default, deliberately: someone moving between English and Yoruba
mid-sentence is the case this product exists to serve, and pinning a code would
defeat it.
