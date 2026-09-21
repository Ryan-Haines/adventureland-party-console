import { mkdir, readFile, writeFile, rename, symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Access } from "./access.ts";
import { listen } from "./listen.ts";
import { gateway } from "./gateway.ts";
import { accountConfig, sessionValue } from "./account.ts";
import { Services } from "./services.ts";
import { servicesHealthy } from "./health.ts";
import { updateHosting } from '../update/hosting.ts';
import { notifyBoot, waitForRelease } from '../update/boot.ts';
import { LocalTLS } from './tls.ts';

const root = fileURLToPath(new URL("../../", import.meta.url));
const data = path.resolve(process.env.AL_DATA_DIR || path.join(root, ".build/hosting-data"));
const caracal = path.join(root, ".caracal");
const dashboardPort = Number(process.env.AL_INTERNAL_DASHBOARD_PORT) || 3030;
await mkdir(data, { recursive: true });
const access = new Access(path.join(data, "access.json"));
await access.load();
let configured = false,
  configuring = false;
const services = new Services();
const development = process.env.AL_DOCKER_DEV === '1';
const tls = new LocalTLS(root, data);
async function configure(raw: string, realm: string) {
  if (configuring || configured)
    throw new Error(
      "Account is already configured; stop the container before replacing its session file",
    );
  const session = sessionValue(raw);
  configuring = true;
  try {
    const config = await accountConfig(session, realm);
    await writeFile(path.join(data, "config.json"), JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    await writeFile(path.join(data, "session.txt.tmp"), session, { mode: 0o600 });
    await rename(path.join(data, "session.txt.tmp"), path.join(data, "session.txt"));
    await startGame();
  } finally {
    configuring = false;
  }
}
async function startGame() {
  await waitForRelease(data);
  const session = (await readFile(path.join(data, "session.txt"), "utf8")).trim();
  await readFile(path.join(data, "config.json"));
  await writeFile(
    path.join(caracal, "config.js"),
    `module.exports = require(${JSON.stringify(path.join(data, "config.json"))});\n`,
  );
  configured = true;
  services.launch(path.join(caracal, "main.js"), caracal, { ...process.env, AL_SESSION: session });
}
// The image prepares these links; a native installation must not silently replace existing state.
for (const name of ["localStorage", "game_files", "logs"]) {
  await mkdir(path.join(data, name), { recursive: true });
  try {
    await lstat(path.join(caracal, name));
  } catch {
    await symlink(
      path.join(data, name),
      path.join(caracal, name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}
services.launch(path.join(root, "tools/dashboard/supervisor.mts"), path.join(root, "dashboard"), {
  ...process.env,
  AL_DASHBOARD_PUBLIC_PORT: String(dashboardPort),
  AL_DASHBOARD_PREBUILT: development ? undefined : ".build/container",
  NODE_ENV: development ? 'development' : 'production',
}, development ? ['--development'] : []);
if (development) services.launch(path.join(root, 'tools/game/watch.mts'), root, process.env);
await notifyBoot(data);
const server = gateway({
  tls,
  access,
  updates: await updateHosting(root, data),
  configure,
  configured: () => configured,
  healthy: () => servicesHealthy(configured, dashboardPort),
  dashboardPort,
  publicUrl: process.env.AL_PUBLIC_URL || undefined,
});
await listen(server, access);
await tls.start();
void startGame().catch(error => {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Game startup failed:', error.message);
});
function shutdown() {
  tls.stop();
  server.close();
  services.stop();
  setTimeout(() => process.exit(0), 15000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
