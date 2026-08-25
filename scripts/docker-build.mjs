/**
 * Builds every service image the way Cloud Build does, locally.
 *
 * Two targets per service, in the order CI uses them:
 *
 *   --target test   runs the suite inside the image; a red suite exits non-zero
 *   (default)       the runtime image that would be pushed
 *
 * The point is that "it builds in CI" stops being something you find out in CI.
 * Always from the repo root: the gateway imports a sibling workspace, and a
 * per-service context cannot see it. See docs/decisions/0003.
 */
import { spawnSync } from "node:child_process";

const SERVICES = [
  "gateway",
  "orchestrator",
  "watcher-runtime",
  "profile-synthesizer",
  "research-cell",
  "connector-gateway",
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const services = only.length ? only : SERVICES;
const skipTests = process.argv.includes("--no-test");

const failures = [];

for (const svc of services) {
  const file = `services/${svc}/Dockerfile`;

  if (!skipTests) {
    process.stdout.write(`  ${svc.padEnd(20)} test  ... `);
    const t = spawnSync(
      "docker",
      ["build", "--target", "test", "-f", file, "-t", `atw-${svc}-test`, "."],
      { encoding: "utf8" },
    );
    if (t.status !== 0) {
      console.log("FAILED");
      // Only the tail: a Docker failure log is mostly layer chatter.
      console.log((t.stderr || t.stdout || "").split("\n").slice(-12).join("\n"));
      failures.push(`${svc} (test)`);
      continue;
    }
    const summary = (t.stderr || "").match(/\d+ passed[^\n]*/)?.[0];
    console.log(summary ? `ok — ${summary}` : "ok");
  }

  process.stdout.write(`  ${svc.padEnd(20)} image ... `);
  const b = spawnSync("docker", ["build", "-f", file, "-t", `atw-${svc}`, "."], {
    encoding: "utf8",
  });
  if (b.status !== 0) {
    console.log("FAILED");
    console.log((b.stderr || b.stdout || "").split("\n").slice(-12).join("\n"));
    failures.push(`${svc} (image)`);
    continue;
  }
  const size = spawnSync("docker", ["images", `atw-${svc}`, "--format", "{{.Size}}"], {
    encoding: "utf8",
  }).stdout.trim().split("\n")[0];
  console.log(`ok — ${size}`);
}

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nall images built");
process.exit(failures.length ? 1 : 0);
