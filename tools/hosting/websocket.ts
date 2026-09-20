import { connect } from "node:net";
import type { Server } from "node:http";
import type { Options } from "./setup-routes.ts";
import { sameBrowserOrigin, validBrowser } from "./authorize.ts";
export function websocket(server: Server, options: Options) {
  server.on("upgrade", (req, socket, head) => {
    if (!sameBrowserOrigin(req, options) || (options.access.required && !validBrowser(req, options)) || /^\/(bridge|setup|party-api|CODE)(\/|$)/.test(req.url || "")) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const target = connect(options.dashboardPort, "127.0.0.1", () => {
      target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      const headers = { ...req.headers, cookie: "", host: `127.0.0.1:${options.dashboardPort}`, origin: `http://127.0.0.1:${options.dashboardPort}` };
      for (const [name, value] of Object.entries(headers)) if (value !== undefined) target.write(`${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
      target.write("\r\n"); target.write(head); socket.pipe(target).pipe(socket);
    });
    target.on("error", () => socket.destroy());
    socket.on("error", () => target.destroy());
    socket.on("close", () => target.destroy());
  });
}
