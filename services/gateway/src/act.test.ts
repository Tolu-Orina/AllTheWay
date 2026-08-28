import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { Role } from "@a2a-js/sdk";

import { connectorInvokeMessage } from "./a2a.js";
import { actOnConfirmed } from "./act.js";
import { mediaFromConnectorTask, videoPollFromConnectorTask, videoStartFromConnectorTask } from "./media-persist.js";

/**
 * The gap this closes: confirming a plan wrote a ledger row and nothing else.
 * "Yes" left the calendar empty, the draft unwritten, and the user with a
 * record of having agreed to something that never happened.
 */

test("a connector invoke uses the numeric Role enum, not a string name", () => {
  // The string "ROLE_USER" serialises as UNRECOGNIZED and the Python A2A
  // server rejects the request with Invalid params before any tool runs.
  const message = connectorInvokeMessage("m1", { connector: "media", tool: "generate_image" });
  assert.equal(message.role, Role.ROLE_USER);
  assert.notEqual(String(message.role), "ROLE_USER");
  assert.equal(message.parts[0]?.content?.$case, "data");
});

test("a plan with no calls does nothing, and says so by doing nothing", async () => {
  const did = await actOnConfirmed({
    uid: "u1",
    sessionId: "s1",
    steps: [{ label: "Think about it" }, { label: "Read it back", connector: "", tool: "" }],
  });
  assert.deepEqual(did, [], "a step that changes nothing must not reach a connector");
});

test("only steps naming a connector and a tool are replayed", async () => {
  // Without a connector gateway configured the outcome is "skipped" rather than
  // an exception: a decision has already been recorded by this point, and
  // losing it because an environment lacks a connector would be worse.
  const did = await actOnConfirmed({
    uid: "u1",
    sessionId: "s1",
    steps: [
      { label: "Think" },
      { label: "Draft the reply", connector: "google_gmail", tool: "create_draft", arguments: {} },
    ],
  });
  assert.equal(did.length, 1, "only the actionable step is replayed");
  assert.equal(did[0].tool, "create_draft");
  assert.ok(["skipped", "failed", "refused", "done"].includes(did[0].did));
});

test("acting never throws, whatever the connector does", async () => {
  // The caller has already written the ledger row. An exception here would lose
  // the response that tells the user what happened.
  await assert.doesNotReject(
    actOnConfirmed({
      uid: "u1",
      sessionId: "s1",
      steps: [{ label: "x", connector: "nonexistent", tool: "nope", arguments: {} }],
    }),
  );
});

test("media bytes are read from the connector result, not from the text slice", () => {
  const jpeg = Buffer.alloc(90, 7).toString("base64");
  const found = mediaFromConnectorTask({
    artifacts: [
      {
        parts: [
          {
            data: {
              data: {
                content: jpeg,
                mimeType: "image/jpeg",
                model: "gemini-3.1-flash-lite-image",
              },
              trace: ["called media.generate_image"],
            },
          },
        ],
      },
    ],
  });
  assert.equal(found.mimeType, "image/jpeg");
  assert.equal(found.model, "gemini-3.1-flash-lite-image");
  assert.ok(found.body && found.body.equals(Buffer.alloc(90, 7)));
});

test("protobuf stringValue siblings are still a still", () => {
  const jpeg = Buffer.alloc(90, 7).toString("base64");
  const found = mediaFromConnectorTask({
    artifacts: [
      {
        parts: [
          {
            data: {
              content: { stringValue: jpeg },
              mimeType: { stringValue: "image/jpeg" },
              model: { stringValue: "gemini-3.1-flash-lite-image" },
            },
          },
        ],
      },
    ],
  });
  assert.equal(found.mimeType, "image/jpeg");
  assert.ok(found.body && found.body.equals(Buffer.alloc(90, 7)));
});

test("a model error in the media payload is not treated as a still", () => {
  const found = mediaFromConnectorTask({
    data: { error: "Could not generate that image.", status: 400 },
  });
  assert.equal(found.error, "Could not generate that image.");
  assert.equal(found.body, undefined);
});

test("a refusal reason is a failed still, not an unreadable shape", () => {
  // Vertex 403 arrives as a refusal artifact with `reason`, not `error`.
  // Treating that as "no still" is how Studio said the bytes were malformed.
  const found = mediaFromConnectorTask({
    artifacts: [
      {
        parts: [
          {
            data: {
              refusal: "unavailable",
              reason: "The image model refused the call (403).",
              trace: ["Called media.generate_image"],
            },
          },
        ],
      },
    ],
  });
  assert.equal(found.error, "The image model refused the call (403).");
  assert.equal(found.body, undefined);
});

test("a video start is an operation name, not bytes", () => {
  const found = videoStartFromConnectorTask({
    artifacts: [
      {
        parts: [
          {
            data: {
              data: {
                operation: "projects/p/locations/global/publishers/google/models/veo-3.1-lite-generate-001/operations/abc",
                model: "veo-3.1-lite-generate-001",
                seconds: 6,
                started: true,
              },
            },
          },
        ],
      },
    ],
  });
  assert.equal(found.operation?.endsWith("/operations/abc"), true);
  assert.equal(found.model, "veo-3.1-lite-generate-001");
  assert.equal(found.seconds, 6);
  assert.equal(found.error, undefined);
});

test("a video poll that is not done is not treated as a clip", () => {
  const found = videoPollFromConnectorTask({
    data: { done: false, operation: "ops/abc", model: "veo-3.1-lite-generate-001" },
  });
  assert.equal(found.done, false);
  assert.equal(found.body, undefined);
  assert.equal(found.error, undefined);
});
