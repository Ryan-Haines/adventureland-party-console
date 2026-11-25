import { access, readFile, readdir, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

export const inspectorPort = 19245;
// The OS process bounds: the Windows process list query and the game launcher's start. execFile
// ends a child past its timeout with `killed` set, which the callers' errors carry.
const PROCESS_LIST_MS = 5000;
const LAUNCH_MS = 10000;
export function automationEnvironment(platform: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (platform === 'win32') return { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${inspectorPort}` };
  if (platform === 'linux') return { ...env, WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${inspectorPort}` };
  throw Error('Automatic Steam launch supports Windows and Linux.');
}
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
export function libraryPaths(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"\r\n]+)"/g)].map(match => match[1].replaceAll('\\\\', '\\'));
}
async function steamLibraries(platform: string) {
  const roots = platform === 'win32'
    ? [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam')]
    : [path.join(homedir(), '.steam/steam'), path.join(homedir(), '.local/share/Steam'),
      path.join(homedir(), '.var/app/com.valvesoftware.Steam/.local/share/Steam')];
  const libraries = new Set(roots);
  for (const root of roots) {
    try { for (const library of libraryPaths(await readFile(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8'))) libraries.add(library); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return libraries;
}
async function libraryExecutable(library: string, platform: string) {
  let directoryName = 'adventureland';
  try {
    const manifest = await readFile(path.join(library, 'steamapps/appmanifest_777150.acf'), 'utf8');
    directoryName = /"installdir"\s+"([^"\r\n]+)"/.exec(manifest)?.[1] || directoryName;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const directory = path.resolve(library, 'steamapps/common', directoryName);
  if (path.dirname(directory) !== path.resolve(library, 'steamapps/common')) throw Error('Invalid Steam installation directory.');
  const names = platform === 'win32' ? ['Adventure Land.exe'] : ['Adventure Land', 'adventure-land', 'adventureland'];
  for (const name of names) if (await exists(path.join(directory, name))) return path.join(directory, name);
}
export async function findExecutable(platform = process.platform): Promise<string> {
  const configured = process.env.AL_STEAM_EXECUTABLE;
  if (configured) {
    if (!path.isAbsolute(configured) || !await exists(configured)) throw Error('AL_STEAM_EXECUTABLE must name an installed Adventure Land executable.');
    return configured;
  }
  const libraries = await steamLibraries(platform);
  for (const library of libraries) {
    const executable = await libraryExecutable(library, platform);
    if (executable) return executable;
  }
  throw Error('Adventure Land was not found in your Steam libraries. Set AL_STEAM_EXECUTABLE to its installed executable.');
}
export async function gameRunning(executable: string, platform = process.platform): Promise<boolean> {
  if (platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process -Filter "Name=\'Adventure Land.exe\'" | Select-Object -ExpandProperty ExecutablePath';
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: PROCESS_LIST_MS });
    return stdout.split(/\r?\n/).some(value => value.trim().toLowerCase() === executable.toLowerCase());
  }
  for (const pid of (await readdir('/proc')).filter(value => /^\d+$/.test(value))) {
    try {
      const actual = await readlink(`/proc/${pid}/exe`);
      if (actual === executable || (actual.startsWith(path.dirname(executable) + path.sep) && /adventure/i.test(path.basename(actual)))) return true;
    }
    catch { /* Processes may exit between directory and link reads. */ }
  }
  return false;
}
export async function launchGame(executable: string, platform = process.platform): Promise<void> {
  if (platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    throw Error('No Linux desktop session is available. Start Party Console from the same desktop session as Steam.');
  const options = { cwd: path.dirname(executable), env: automationEnvironment(platform, process.env), windowsHide: true, timeout: LAUNCH_MS };
  // An intermediate launcher exits immediately: coordinator process-tree cleanup
  // must not own or terminate the player's Steam window on a later restart.
  if (platform === 'win32') {
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Start-Process -FilePath $env:PARTY_GAME_EXECUTABLE -WorkingDirectory (Split-Path -LiteralPath $env:PARTY_GAME_EXECUTABLE) -WindowStyle Normal'],
      { ...options, env: { ...options.env, PARTY_GAME_EXECUTABLE: executable } });
  } else await new Promise<void>((resolve, reject) => {
    const child = spawn('setsid', ['--fork', executable], { ...options, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('Adventure Land launcher failed.')));
  });
}
