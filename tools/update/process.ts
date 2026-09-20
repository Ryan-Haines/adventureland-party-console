import { spawn } from 'node:child_process';
export async function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}): ${error.slice(-1500)}`)));
  });
}
