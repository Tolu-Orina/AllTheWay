import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * One `upgrade` listener per server, shared by every WebSocket endpoint.
 *
 * ## Why this exists
 *
 * Node calls *every* `upgrade` listener for *every* upgrade request. The voice
 * relay used to install its own and destroy any socket whose path it did not
 * recognise — correct while it was the only endpoint, and fatal the moment a
 * second one appeared: meeting capture would have had its socket torn down by
 * voice before its own listener ever ran.
 *
 * That failure would have been unusually hard to read, too. The client sees a
 * connection closed immediately after the handshake, with no error and nothing
 * in the logs of the endpoint it was trying to reach — because that endpoint
 * never saw it.
 *
 * So path matching happens once, here, and 404 is only sent when nothing claims
 * the path.
 */

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

const routers = new WeakMap<Server, Map<string, UpgradeHandler>>();

export function routeUpgrade(server: Server, path: string, handler: UpgradeHandler): void {
  const existing = routers.get(server);
  if (existing) {
    existing.set(path, handler);
    return;
  }

  const routes = new Map<string, UpgradeHandler>([[path, handler]]);
  routers.set(server, routes);

  server.on("upgrade", (req, socket, head) => {
    const host = req.headers.host ?? "localhost";
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", `http://${host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    const route = routes.get(pathname);
    if (!route) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    route(req, socket, head);
  });
}
