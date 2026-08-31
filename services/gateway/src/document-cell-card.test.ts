import "./test-env.js";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { servedCard } from "./agent-card-sign.js";
import { agentCard, createDocumentCellApp } from "./document-cell-server.js";

test("a document-cell card without a key is unsigned, not invented", () => {
  const card = servedCard(agentCard as Record<string, unknown>, { signingKey: "" });
  assert.equal("signatures" in card, false);
});

test("a document-cell card with a key carries one signature", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const card = servedCard(agentCard as Record<string, unknown>, {
    signingKey: pem,
    keyId: "alltheway",
  });
  const signatures = card.signatures as { protected?: string; signature?: string }[];
  assert.equal(signatures.length, 1);
  assert.ok(signatures[0]?.protected);
  assert.ok(signatures[0]?.signature);
  assert.equal(card.name, "AllTheWay Document Cell");
});

test("the well-known endpoint serves the card as JSON", async () => {
  const app = createDocumentCellApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name?: string };
    assert.equal(body.name, "AllTheWay Document Cell");

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const report = (await health.json()) as { cardSigned?: boolean };
    assert.equal(report.cardSigned, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
