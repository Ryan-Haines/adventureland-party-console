// Runs the actual debug control gateway as the regular unprivileged Docker user.
import { grantDockerSocket } from '../tools/hosting/docker-access.ts';
import { DebugInstances } from '../tools/debug/service.ts';
import { Access } from '../tools/hosting/access.ts';
import { gateway } from '../tools/hosting/gateway.ts';
if (process.getuid?.() === 0) {
  await grantDockerSocket('1000');
  process.execve!('/usr/sbin/gosu', ['gosu', 'node', 'node', 'e2e/debug-container-host.mts'], process.env as Record<string, string>);
}
const directory = '/tmp/debug-container-e2e';
const debug = await new DebugInstances(process.cwd(), directory).load();
const access = new Access(directory + '/access.json'); await access.load();
gateway({ debug, access, configured: () => true, dashboardPort: 3030, apiPort: 924 }).listen(3010, '0.0.0.0');
