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
token; it never reads one out of storage, and it never receives a refresh token,
so it has to come back to a signed-in page every hour.

## Using it

1. Join the meeting as normal.
2. Click the extension, tick the disclosure box, press **Start taking notes**.
3. Notes and commitments appear in AllTheWay, exactly as for any other meeting.

There is no picker dialog: `chrome.tabCapture` targets the active tab directly.
That is the whole reason this is an extension rather than a button in the web
app, where `getDisplayMedia` would force a picker on every meeting.

## The disclosure box is not a formality

A bot is visible in the participant list, so the platform announces it for you.
This announces nothing, and the obligation moves entirely to the person pressing
the button. In all-party-consent jurisdictions — California and Illinois among
them — recording without telling everyone is unlawful however it is done.

The box is unticked every time the popup opens, deliberately. "I told them" is
true of one meeting; remembering it would silently assert it about the next.
The server refuses a session without it too, because a checkbox in an extension
is a courtesy and the gateway is the boundary.

## Known limits

- **Chromium only**, and **browser tabs only** — a native Zoom or Teams desktop
  client cannot be captured this way.
- **Closing the captured tab ends the recording.** Chrome gives no way around
  this; the extension reports it rather than appearing to still record.
- **Switching tabs can drop audio briefly** through background throttling.
  Gaps over two seconds are labelled in the notes rather than silently omitted.
- **90-minute cap**, enforced by the gateway as well as the client. A capture
  that ran because a client forgot to stop is exactly the cost this bounds.

## Publishing

Sensitive permissions from a new account should expect **2–4 weeks** of Chrome
Web Store review; unlisted still requires it. For an organisation, force-install
via Workspace admin policy avoids the public store entirely.

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

**No speaker diarization.** This model does not support it, so notes render
speakers as "Unattributed" rather than guessing. Word-level timestamps are also
unsupported; utterance-level are.

**85+ languages, auto-detected, including switching mid-sentence.** No language
is forced by default, deliberately: someone moving between English and Yoruba
mid-sentence is the case this product exists to serve, and pinning a code would
defeat it.
