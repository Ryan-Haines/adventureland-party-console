import { networkInterfaces } from "node:os";
import type { Server } from "node:http";
import type { Access } from "./access.ts";
export async function listen(server: Server, access: Access) {
  const port = Number(process.env.AL_PORT || 3010), host = process.env.AL_HOST || "0.0.0.0";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid AL_PORT");
  const invitation = access.required ? await access.invitation() : undefined;
  const addresses = host === "0.0.0.0"
    ? ["localhost", ...Object.values(networkInterfaces()).flatMap(entries => (entries || []).filter(e => e.family === "IPv4" && !e.internal).map(e => e.address))]
    : [host.includes(":") ? `[${host}]` : host];
  server.listen(port, host, () => {
    const urls = new Set([...(process.env.AL_PUBLIC_URL ? [process.env.AL_PUBLIC_URL] : []), ...addresses.map(address => `http://${address}:${port}`)]);
    for (const url of urls) {
      console.log("Dashboard: " + url);
      if (invitation) console.log("Pair browser: " + url + "/setup#" + invitation);
    }
  });
}
