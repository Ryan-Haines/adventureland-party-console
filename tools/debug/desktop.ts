import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
/** Private virtual desktop; only the authenticated gateway exposes its viewer. */
export async function startDesktop(own: (process: ChildProcess) => void) {
  const run = (command: string, args: string[]) => { const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] }); own(child); return child; };
  await displayReady(run('Xvfb', [':99', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp']), '/tmp/.X11-unix/X99');
  run('x11vnc', ['-display', ':99', '-localhost', '-rfbport', '5900', '-nopw', '-forever', '-shared', '-quiet']);
  run('websockify', ['--web', '/usr/share/novnc', '127.0.0.1:6080', '127.0.0.1:5900']);
}
/** The X display is ready once its socket file exists, and failed once Xvfb exits or cannot start, so
 *  the wait has no attempt count. */
export async function displayReady(xvfb: Pick<ChildProcess, 'once'>, socket: string): Promise<void> {
  let failed = false;
  const fail = () => { failed = true; };
  xvfb.once('exit', fail); xvfb.once('error', fail);
  for (;;) {
    if (failed) throw Error('Debug game display failed to start');
    if (await access(socket).then(() => true, () => false)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
