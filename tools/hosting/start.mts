import { mkdir, readFile, writeFile, rename, symlink, lstat, realpath, readlink } from "node:fs/promises";
import {createHash, randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Access } from "./access.ts";
import { DebugInstances } from '../debug/service.ts';
import { listen } from "./listen.ts";
import { gateway } from "./gateway.ts";
import { accountConfig, sessionValue } from "./account.ts";
import { Services } from "./services.ts";
import { servicesHealthy } from "./health.ts";
import { updateHosting } from '../update/hosting.ts';
import { notifyBoot, waitForRelease } from '../update/boot.ts';
import { LocalTLS } from './tls.ts';
import { configureDashboardGateway } from '../dashboard/gateway-access.ts';
import { createLocalSteam } from '../steam/service.ts';
import { loadManagedConsole } from '../console-build/bootstrap.ts';
import {migrateHostingData, preparePackagedStorage, preparePartyStorage} from './windows-party-storage.ts';

const root = fileURLToPath(new URL("../../", import.meta.url));
const oldData = path.join(root, '.build/hosting-data');
const nativeDefault = process.platform === 'linux' && !process.env.AL_DATA_DIR;
const data = path.resolve(process.env.AL_DATA_DIR || (nativeDefault
  ? await migrateHostingData(root, path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local/share'),
      'adventureland-party-console/instances', createHash('sha256').update(await realpath(root)).digest('hex').slice(0,16)))
  : oldData));
process.env.AL_DATA_DIR = data;
const caracal = path.join(root, ".caracal");
const storage = process.platform === 'win32' && process.env.AL_INSTALL_HOME
  ? await preparePackagedStorage(root, data, process.env.AL_INSTALL_HOME)
  : await preparePartyStorage(root, data);
const dashboardPort = Number(process.env.AL_INTERNAL_DASHBOARD_PORT) || 3030;
const apiPort = Number(process.env.AL_INTERNAL_API_PORT) || 924;
await mkdir(data, { recursive: true });
const access = new Access(path.join(data, "access.json"));
await access.load();
let configured = false,
  configuring = false;
const services = new Services();
configureDashboardGateway();
const development = process.env.AL_DOCKER_DEV === '1' || process.argv.includes('--development');
const staged = process.env.AL_CONSOLE_MANAGED === '1' || development;
let managed: Awaited<ReturnType<typeof loadManagedConsole>> | undefined;
const tls = new LocalTLS(root, data);
// A failed native startup must not leave detached dashboard/game services behind.
process.once('exit', () => { services.stop(); tls.stop(); });
async function configure(raw: string, realm: string) {
  if (configuring || configured)
    throw new Error(
      "Account is already configured; stop Party Console before replacing its session file",
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
    `const config = require(${JSON.stringify(path.join(data, "config.json"))});\nmodule.exports = { ...config, web_app: { ...config.web_app, port: ${apiPort} } };\n`,
  );
  configured = true;
  const preload = path.join(root, 'tools/hosting/windows-storage-preload.cjs').replaceAll('\\', '/');
  const env = { ...process.env, AL_DATA_DIR: data, AL_SESSION: session, AL_CONSOLE_NATIVE_DIR: caracal,
    AL_PARTY_STORAGE_DIR: storage, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require=' + JSON.stringify(preload)].filter(Boolean).join(' ') };
  if (managed) await managed.startGame(env);
  else services.launch(path.join(caracal, "main.js"), caracal, env);
}
// The image prepares these links; a native installation must not silently replace existing state.
for (const name of ["localStorage", "game_files", "logs"]) {
  await mkdir(path.join(data, name), { recursive: true });
  try {
    const file = path.join(caracal, name);
    const info = await lstat(file);
    if (nativeDefault && info.isSymbolicLink() && path.resolve(caracal, await readlink(file)) === path.join(oldData, name)) {
      const replacement = file + '.' + randomUUID();
      await symlink(path.join(data, name), replacement, 'dir');
      await rename(replacement, file);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await symlink(
      path.join(data, name),
      path.join(caracal, name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}
if (staged) managed = await loadManagedConsole(root, services, { dashboardPort, apiPort });
else services.launch(path.join(root, "tools/dashboard/supervisor.mts"), path.join(root, "dashboard"), {
  ...process.env,
  AL_DASHBOARD_PUBLIC_PORT: String(dashboardPort),
  AL_DASHBOARD_PREBUILT: development ? undefined : ".build/container",
  NODE_ENV: development ? 'development' : 'production',
}, development ? ['--development'] : []);
await notifyBoot(data);
let steamServer: string | undefined;
const steam = createLocalSteam(root, data, apiPort, async () => steamServer ??=
  (process.platform === 'linux' ? `https://localhost:${tls.publicPort}` : `http://127.0.0.1:${process.env.AL_PORT || 3010}`) + '/bridge/' + await access.steam());
const server = gateway({
  builds: managed?.routes,
  code:managed?.code,
  debug: await new DebugInstances(root, path.join(data, 'debug')).load(),
  steam,
  tls,
  access,
  updates: await updateHosting(root, data),
  configure,
  configured: () => configured,
  healthy: () => servicesHealthy(configured, dashboardPort, apiPort),
  apiPort,
  dashboardPort,
  publicUrl: process.env.AL_PUBLIC_URL || undefined,
});
await listen(server, access);
await tls.start();
void startGame().catch(error => {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Game startup failed:', error.message);
});
function shutdown() {
  steam.stop();
  tls.stop();
  server.close();
  services.stop();
  void managed?.stop();
  setTimeout(() => process.exit(0), 15000).unref();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
