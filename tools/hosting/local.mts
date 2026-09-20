import { mkdir } from "node:fs/promises";
import { Access } from "./access.ts";
import { gateway } from "./gateway.ts";
import { listen } from "./listen.ts";
import { servicesHealthy } from "./health.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Services } from "./services.ts";
import { updateHosting } from '../update/hosting.ts';
const root = fileURLToPath(new URL("../../", import.meta.url)),
  services = new Services();
const data = path.resolve(process.env.AL_DATA_DIR || path.join(root, ".build/hosting-data"));
await mkdir(data, { recursive: true });
const access = new Access(path.join(data, "access.json"));
await access.load();
const server = gateway({ access, updates: await updateHosting(root, data), configured: () => true, healthy: () => servicesHealthy(true), dashboardPort: 3030, publicUrl: process.env.AL_PUBLIC_URL || undefined });
await listen(server, access);
if (!process.argv.includes("--coordinator-only"))
  services.launch(path.join(root, "tools/game/watch.mts"), root, process.env);
services.launch(
  path.join(root, "tools/dashboard/supervisor.mts"),
  path.join(root, "dashboard"),
  { ...process.env, AL_DASHBOARD_PUBLIC_PORT: "3030", AL_DASHBOARD_MODE_FILE: ".build/mode.json" },
  process.argv.slice(2).filter(arg => !arg.startsWith("--port=")),
);
services.launch(path.join(root, ".caracal/main.js"), path.join(root, ".caracal"), process.env);
const stop = () => {
  server.close();
  services.stop();
  setTimeout(() => process.exit(0), 15000).unref();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
