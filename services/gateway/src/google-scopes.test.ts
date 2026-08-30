import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectorIsConnected,
  listedGoogleConnectors,
  scopesToRequest,
  googleGrantId,
  GMAIL_DRAFTS_SCOPE,
  createDraftSkipReason,
} from "./google-scopes.js";

test("a Gmail-only grant does not mark Calendar, Drive or Docs connected", () => {
  const granted = ["https://www.googleapis.com/auth/gmail.send"];
  assert.equal(connectorIsConnected("google_gmail", granted), true);
  assert.equal(connectorIsConnected("google_calendar", granted), false);
  assert.equal(connectorIsConnected("google_drive", granted), false);
  assert.equal(connectorIsConnected("google_docs", granted), false);
  assert.equal(connectorIsConnected("google_meet", granted), false);
});

test("a Calendar grant does not mark Gmail connected", () => {
  const granted = ["https://www.googleapis.com/auth/calendar.events"];
  assert.equal(connectorIsConnected("google_calendar", granted), true);
  assert.equal(connectorIsConnected("google_gmail", granted), false);
});

test("Docs needs both documents and drive.file", () => {
  assert.equal(
    connectorIsConnected("google_docs", ["https://www.googleapis.com/auth/documents"]),
    false,
  );
  assert.equal(
    connectorIsConnected("google_docs", [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
    ]),
    true,
  );
});

test("requesting Gmail asks only for Gmail, not the Google union", () => {
  const scopes = scopesToRequest("google_gmail", false);
  assert.deepEqual(scopes, ["https://www.googleapis.com/auth/gmail.send"]);
  assert.ok(!scopes.some((s) => s.includes("calendar")));
  assert.ok(!scopes.some((s) => s.includes("documents")));
});

test("drafts adds the restricted compose scope only for Gmail", () => {
  const gmail = scopesToRequest("google_gmail", true);
  assert.ok(gmail.includes(GMAIL_DRAFTS_SCOPE));
  const calendar = scopesToRequest("google_calendar", true);
  assert.ok(!calendar.includes(GMAIL_DRAFTS_SCOPE));
});

test("a connected Gmail without compose does not silently send", () => {
  const sendOnly = ["https://www.googleapis.com/auth/gmail.send"];
  assert.equal(connectorIsConnected("google_gmail", sendOnly), true);
  assert.match(createDraftSkipReason(sendOnly) ?? "", /drafts is off/i);
  assert.equal(createDraftSkipReason([...sendOnly, GMAIL_DRAFTS_SCOPE]), null);
});

test("an unknown connector is not connected and requests nothing", () => {
  assert.equal(connectorIsConnected("github", ["anything"]), false);
  assert.deepEqual(scopesToRequest("github", false), []);
});

test("Google grants share one document per user, not per connector", () => {
  assert.equal(googleGrantId("u1"), "u1::google");
  assert.notEqual(googleGrantId("u1"), "u1:google_gmail");
});

test("a declared Gmail connect does not list Calendar even if those scopes are on the token", () => {
  const granted = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
  ];
  assert.deepEqual(listedGoogleConnectors(granted, ["google_gmail"]), ["google_gmail"]);
});

test("a grant with no declared list does not tick every Google row from leftover scopes", () => {
  const granted = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
  ];
  assert.deepEqual(listedGoogleConnectors(granted, undefined), []);
});
