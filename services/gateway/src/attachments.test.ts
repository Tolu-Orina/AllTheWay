import { equal, deepEqual } from "node:assert/strict";
import { test } from "node:test";

import { documentIdsOf, parseTurnAttachments } from "./attachments.js";

test("parseTurnAttachments keeps at most five valid metas", () => {
  const attachments = parseTurnAttachments(
    JSON.stringify([
      { name: "Contract.pdf", mime: "application/pdf", size: 1200, documentId: "d1" },
      { name: "Photo.jpg", mime: "image/jpeg", size: 800, documentId: "d2" },
    ]),
  );
  equal(attachments.length, 2);
  equal(attachments[0]?.name, "Contract.pdf");
  deepEqual(documentIdsOf(attachments), ["d1", "d2"]);
});

test("parseTurnAttachments ignores junk rather than failing the turn", () => {
  equal(parseTurnAttachments("not-json").length, 0);
  equal(parseTurnAttachments({ name: "x" }).length, 0);
  equal(parseTurnAttachments("").length, 0);
});
