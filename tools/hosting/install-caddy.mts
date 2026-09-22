import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const caddyVersion = '2.11.4';
const checksums: Record<string, string> = {
 'linux_amd64.tar.gz': '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9',
 'linux_arm64.tar.gz': 'd5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c',
 'windows_amd64.zip': 'cd5ccfd86a4b40732cf715890d0dca5bf3f63adefec5a7914de85adf240c60ce7e5d2791631b88ef9758e46b23bb1730e020b9c5d696889740b284ffd4788e35',
 'windows_arm64.zip': '582ad4657223ecd52a627d88b9d5a0cc051a0289546427659e878c57db3b4f44cedf9edd8ad6efcf29aa20a156d72626db00dfb64caccfe207bbebea2a0773c4',
};
export function caddyPath(root: string) {
 return path.join(root, '.build', 'caddy', caddyVersion, process.platform === 'win32' ? 'caddy.exe' : 'caddy');
}
export async function installCaddy(root: string) {
 const destination = caddyPath(root);
 try { await readFile(destination); await readFile(path.join(path.dirname(destination), 'LICENSE')); return destination; } catch { /* first installation */ }
 const os = process.platform === 'win32' ? 'windows' : process.platform;
 const arch = process.arch === 'x64' ? 'amd64' : process.arch;
 const suffix = `${os}_${arch}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
 const expected = checksums[suffix];
 if (!expected) throw new Error('Automatic HTTPS supports Windows/Linux x64 and arm64');
 const response = await fetch(`https://github.com/caddyserver/caddy/releases/download/v${caddyVersion}/caddy_${caddyVersion}_${suffix}`, { signal: AbortSignal.timeout(120000) });
 if (!response.ok) throw new Error(`Caddy download failed: HTTP ${response.status}`);
 const bytes = Buffer.from(await response.arrayBuffer());
 if (createHash('sha512').update(bytes).digest('hex') !== expected) throw new Error('Caddy download checksum mismatch');
 const temporary = await mkdtemp(path.join(tmpdir(), 'party-caddy-'));
 try {
  const archive = path.join(temporary, 'download.' + (os === 'windows' ? 'zip' : 'tar.gz'));
  await writeFile(archive, bytes);
  execFileSync('tar', ['-xf', archive, '-C', temporary, path.basename(destination), 'LICENSE'], { windowsHide: true });
  await mkdir(path.dirname(destination), { recursive: true });
  const binary = await readFile(path.join(temporary, path.basename(destination)));
  await writeFile(destination + '.tmp', binary); await chmod(destination + '.tmp', 0o755);
  await rename(destination + '.tmp', destination);
  await writeFile(path.join(path.dirname(destination), 'LICENSE'), await readFile(path.join(temporary, 'LICENSE')));
 } finally { await rm(temporary, { recursive: true, force: true }); }
 return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 void installCaddy(fileURLToPath(new URL('../../', import.meta.url)))
  .then(() => console.log('HTTPS service installed (Caddy ' + caddyVersion + ').'))
  .catch(error => { console.error(error); process.exitCode = 1; });
}
