// Can a browser actually open the voice socket at each candidate host?
import WebSocket from "ws";

const ORIGIN = "https://alltheway.rinegansolutions.com";
const hosts = [
  ["via Firebase Hosting", "wss://alltheway.rinegansolutions.com/api/voice/live"],
  ["direct to Cloud Run", `wss://${process.argv[2]}/api/voice/live`],
];

for (const [label, url] of hosts) {
  await new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { origin: ORIGIN } });
    const timer = setTimeout(() => {
      console.log(`  ${label}: TIMEOUT (no upgrade)`);
      try { ws.terminate(); } catch {}
      resolve();
    }, 12_000);
    const done = (msg) => {
      clearTimeout(timer);
      console.log(`  ${label}: ${msg}`);
      try { ws.close(); } catch {}
      resolve();
    };
    ws.on("open", () => {
      // Upgrade succeeded. Send deliberate garbage: a live relay must reject it
      // as unauthenticated rather than accept it.
      ws.send(JSON.stringify({ auth: { token: "not-a-token", sessionId: "probe" } }));
    });
    ws.on("message", (d) => done(`UPGRADED, relay replied ${String(d).slice(0, 120)}`));
    ws.on("close", (code, reason) =>
      done(`closed ${code} ${reason?.toString().slice(0, 80)}`),
    );
    ws.on("error", (e) => done(`ERROR ${e.message.slice(0, 120)}`));
  });
}
