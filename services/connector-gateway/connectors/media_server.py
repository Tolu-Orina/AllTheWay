"""Images and video, as an MCP server behind the policy point.

Generation lives here rather than in the orchestrator for one reason: this is
the single enforcement point in front of every connector, and generating media
is an *effect* — it costs money, it is metered, and one of these tools can
spend five pounds in a click. Putting it beside the autonomy floor means it
inherits severity, confirmation and quota rather than needing its own.

## No per-user credential

Unlike the Google connectors, nothing here acts on a user's account. It calls
Vertex with the service's own identity, so there is no OAuth, no scope check
and no consent — which is why `media` is deliberately absent from
`NEEDS_OAUTH`.

## The ladder, and why the user never sees it

    draft     veo-3.1-lite-generate-001   ~$0.05/s   the first six attempts
    standard  veo-3.1-fast-generate-001   ~$0.10/s   the one you are fairly sure of
    final     veo-3.1-generate-001        ~$0.75/s   the one you will send

A user asks for a draft or a final. Which model that means is an implementation
detail of that choice, exactly as Nano Banana 2 Lite is an implementation
detail of "show me a wireframe".

## Bytes are never re-encoded

Verified on real output: a generated image carries C2PA content credentials in
a JUMBF box inside an APP11 segment, and SynthID invisibly in the pixels. Any
resize, recompress or format conversion destroys the first and can damage the
second. So the bytes returned by the model are the bytes stored, unchanged —
FR-M1's "preserved through storage and export" is a *don't touch it* rule, not
a feature to implement.

The model returns JPEG, not PNG. The mime type comes from the response rather
than being assumed.

## What is verified, and what is not

Image generation was exercised against the live model: 200, `inlineData`,
79KB of JPEG with C2PA present.

**Video generation is not verified.** `:predictLongRunning` does not describe a
model — it *starts* a generation, and there is no way to exercise the path
without being billed for it. Two Veo generations already ran accidentally at
roughly $6 each during earlier probing. So this code is written against the
documented shape and marked unverified rather than tested into existence, and
the first real render should be watched.
"""

from __future__ import annotations

import base64
import json
import os
import time

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("alltheway-media")

#: Deliberately NOT GOOGLE_CLOUD_LOCATION. That is `global` for text, and these
#: models are `global`-only too — but they are a different concern, and
#: collapsing two regions into one variable is what broke voice for a week.
LOCATION = os.environ.get("MEDIA_LOCATION", "global")

IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "gemini-3.1-flash-lite-image")

#: The ladder. Names verified present on Vertex; only the image path has been
#: exercised end to end.
VIDEO_MODELS = {
    "draft": os.environ.get("VIDEO_DRAFT_MODEL", "veo-3.1-lite-generate-001"),
    "standard": os.environ.get("VIDEO_STANDARD_MODEL", "veo-3.1-fast-generate-001"),
    "final": os.environ.get("VIDEO_FINAL_MODEL", "veo-3.1-generate-001"),
}

IMAGE_TIMEOUT = 60.0
VIDEO_START_TIMEOUT = 60.0
VIDEO_POLL_TIMEOUT = 420.0
VIDEO_POLL_INTERVAL = 6.0


def _host() -> str:
    return "aiplatform" if LOCATION == "global" else f"{LOCATION}-aiplatform"


def _project() -> str:
    return os.environ.get("GOOGLE_CLOUD_PROJECT", "")


def _token() -> str:
    import google.auth
    import google.auth.transport.requests

    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    credentials.refresh(google.auth.transport.requests.Request())
    return credentials.token


def _fail(message: str, **extra) -> str:
    return json.dumps({"error": message, **extra})


def _vertex_refusal(response: httpx.Response) -> str:
    """Say why Vertex refused, not that a still arrived malformed."""
    detail = ""
    try:
        message = (response.json().get("error") or {}).get("message")
        if isinstance(message, str) and message.strip():
            detail = message.strip()[:240]
    except ValueError:
        pass
    if response.status_code == 403:
        return (
            f"The image model refused the call ({response.status_code})"
            + (f": {detail}" if detail else ".")
        )
    return (
        f"Could not generate that image ({response.status_code})"
        + (f": {detail}" if detail else ".")
    )


@mcp.tool()
def generate_image(prompt: str, style: str = "") -> str:
    """Generate an image from a description. Cheap enough to iterate on.

    `style` carries the user's remembered visual preferences — palette,
    density, corner radius. It is appended rather than merged into the prompt
    so that a correction can change it without rewriting what was asked for.
    """
    if not prompt.strip():
        return _fail("Nothing to draw.")

    instruction = f"{prompt.strip()}\n\n{style.strip()}" if style.strip() else prompt.strip()
    url = (
        f"https://{_host()}.googleapis.com/v1/projects/{_project()}"
        f"/locations/{LOCATION}/publishers/google/models/{IMAGE_MODEL}:generateContent"
    )

    try:
        with httpx.Client(timeout=IMAGE_TIMEOUT) as http:
            response = http.post(
                url,
                headers={"Authorization": f"Bearer {_token()}"},
                json={
                    "contents": [{"role": "user", "parts": [{"text": instruction}]}],
                    "generationConfig": {"responseModalities": ["IMAGE"]},
                },
            )
    except httpx.HTTPError as exc:
        return _fail(f"Could not reach the image model ({type(exc).__name__}).")

    if response.status_code != 200:
        return _fail(_vertex_refusal(response), status=response.status_code)

    for candidate in response.json().get("candidates", []):
        for part in (candidate.get("content") or {}).get("parts", []):
            inline = part.get("inlineData")
            if inline and inline.get("data"):
                # Returned untouched. Re-encoding would strip the C2PA
                # credentials this image is carrying.
                return json.dumps(
                    {
                        "content": inline["data"],
                        "mimeType": inline.get("mimeType", "image/jpeg"),
                        "model": IMAGE_MODEL,
                        "generated": True,
                    }
                )

    # A refusal comes back as text rather than an image. Reported as such,
    # because "the model declined" and "the call failed" need different fixes.
    return _fail("The model returned no image.")


def _model_from_operation(operation: str) -> str:
    """Vertex operation names include the model. Used when a poll arrives
    without one, so the fetch URL can still be built."""
    parts = operation.split("/")
    try:
        index = parts.index("models")
        return parts[index + 1]
    except (ValueError, IndexError):
        return ""


def _video_url(model: str) -> str:
    return (
        f"https://{_host()}.googleapis.com/v1/projects/{_project()}"
        f"/locations/{LOCATION}/publishers/google/models/{model}"
    )


def _start_video(prompt: str, rung: str, seconds: int) -> str:
    """Start a Veo long-running operation. Does not wait for the clip.

    The connector-gateway Cloud Run timeout is 300s and Veo often takes
    longer, so waiting here would be killed mid-generation. The gateway
    stores the operation name and polls.
    """
    if not prompt.strip():
        return _fail("Nothing to film.")

    model = VIDEO_MODELS.get(rung)
    if model is None:
        return _fail(f"Unknown video quality {rung!r}.")

    headers = {"Authorization": f"Bearer {_token()}"}
    try:
        with httpx.Client(timeout=VIDEO_START_TIMEOUT) as http:
            started = http.post(
                f"{_video_url(model)}:predictLongRunning",
                headers=headers,
                json={
                    "instances": [{"prompt": prompt.strip()}],
                    "parameters": {"durationSeconds": seconds, "sampleCount": 1},
                },
            )
    except httpx.HTTPError as exc:
        return _fail(f"Could not start the video ({type(exc).__name__}).")

    if started.status_code != 200:
        return _fail("Could not start that video.", status=started.status_code)

    operation = started.json().get("name")
    if not operation:
        return _fail("The video service returned no operation to wait on.")

    return json.dumps(
        {
            "operation": operation,
            "model": model,
            "seconds": seconds,
            "started": True,
        }
    )


def _bytes_from_poll(body: dict, model: str, seconds: int) -> str | None:
    videos = (body.get("response") or {}).get("videos") or []
    for video in videos:
        data = video.get("bytesBase64Encoded")
        if data:
            return json.dumps(
                {
                    "content": data,
                    "mimeType": video.get("mimeType", "video/mp4"),
                    "model": model,
                    "seconds": seconds,
                    "generated": True,
                    "done": True,
                }
            )
    return None


def _poll_video(operation: str, model: str = "", seconds: int = 0) -> str:
    """One fetchPredictOperation. The caller decides whether to come back."""
    if not operation.strip():
        return _fail("No video operation to check.")

    resolved = (model or _model_from_operation(operation)).strip()
    if not resolved:
        return _fail("Lost track of the video.")

    headers = {"Authorization": f"Bearer {_token()}"}
    try:
        with httpx.Client(timeout=VIDEO_START_TIMEOUT) as http:
            poll = http.post(
                f"{_video_url(resolved)}:fetchPredictOperation",
                headers=headers,
                json={"operationName": operation},
            )
    except httpx.HTTPError as exc:
        return _fail(f"Lost track of the video ({type(exc).__name__}).")

    if poll.status_code != 200:
        return _fail("Lost track of the video.", status=poll.status_code)

    body = poll.json()
    if not body.get("done"):
        return json.dumps(
            {"done": False, "operation": operation, "model": resolved}
        )

    if "error" in body:
        err = body["error"] if isinstance(body["error"], dict) else {}
        return _fail(str(err.get("message", "Video generation failed."))[:200])

    found = _bytes_from_poll(body, resolved, seconds)
    if found:
        return found
    return _fail("The video finished but returned nothing.")


def _wait_for_video(prompt: str, rung: str, seconds: int) -> str:
    """Blocking wait, used only by the final render until that path is async.

    Bounded. A request that never returns holds a Cloud Run instance until
    the platform gives up, and the user is told nothing in the meantime.
    """
    started = json.loads(_start_video(prompt, rung, seconds))
    if started.get("error"):
        return json.dumps(started)
    operation = started.get("operation")
    model = started.get("model") or ""
    if not operation:
        return _fail("The video service returned no operation to wait on.")

    deadline = time.monotonic() + VIDEO_POLL_TIMEOUT
    while time.monotonic() < deadline:
        time.sleep(VIDEO_POLL_INTERVAL)
        polled = json.loads(_poll_video(operation, model, seconds))
        if polled.get("error"):
            return json.dumps(polled)
        if polled.get("done") and polled.get("content"):
            return json.dumps(polled)
        if polled.get("done"):
            return _fail("The video finished but returned nothing.")

    return _fail(
        "That video is taking longer than expected. It may still complete; "
        "it has not been cancelled.",
        operation=operation,
    )


@mcp.tool()
def draft_video(prompt: str, seconds: int = 6) -> str:
    """A cheap draft. Roughly $0.05 per second — for trying an idea.

    Starts the generation and returns immediately. Vertex bills when the
    long-running operation starts, which is why the meter is on this call
    and not on the poll that follows.
    """
    return _start_video(prompt, "draft", max(1, min(int(seconds), 8)))


@mcp.tool()
def poll_draft_video(operation: str, model: str = "", seconds: int = 0) -> str:
    """One look at a draft already started. Unmetered: the start paid."""
    return _poll_video(operation, model, max(0, int(seconds or 0)))


@mcp.tool()
def render_video(prompt: str, seconds: int = 6) -> str:
    """The final render. Roughly $0.75 per second — for the one you will send.

    Classified `MAKE_PAYMENT` in the gateway's registry, which is not a
    metaphor: at fifteen times the draft price, an 8-second render costs about
    six dollars, and the autonomy floor should treat it exactly as it treats
    moving money.
    """
    return _wait_for_video(prompt, "final", max(1, min(int(seconds), 8)))


if __name__ == "__main__":
    mcp.run()
