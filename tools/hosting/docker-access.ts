import { stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
/** An explicitly mounted Docker socket must remain usable after dropping root. The production and dev
 *  Docker hosts call it before they drop root, and the debug container E2E host too. */
export async function grantDockerSocket(uid: string) {
  if (process.getuid?.() !== 0) return;
  const socket = await stat('/var/run/docker.sock').catch(() => null);
  if (!socket?.isSocket()) return;
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status !== 0) throw Error(`Docker socket setup: ${command}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const gid = String(socket.gid);
  if (spawnSync('getent', ['group', gid]).status !== 0) run('groupadd', ['--gid', gid, 'party-debug-docker']);
  let user = spawnSync('getent', ['passwd', uid], { encoding: 'utf8' }).stdout.trim().split(':')[0];
  if (!user) { user = 'party-debug-host'; run('useradd', ['--uid', uid, '--no-create-home', user]); }
  run('usermod', ['-a', '-G', gid, user]);
}
