import { request } from 'node:https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function verifyHTTPS(data: string, port = 3443) {
 const ca = await readFile(path.join(data, 'tls/caddy/pki/authorities/local/root.crt'));
 const get = (pathname: string) => new Promise<string>((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path: pathname, ca, agent: false }, res => {
   let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => {
    if (res.statusCode !== 200) reject(Error('HTTPS ' + pathname + ': ' + res.statusCode));else resolve(body);
   });
  });
  req.on('error', reject);req.setTimeout(5000, () => req.destroy(Error('HTTPS check timed out')));req.end();
 });
 if (!(await get('/setup')).includes('Party Console')) throw Error('HTTPS setup did not render');
 if (!JSON.parse(await get('/setup/state')).secure) throw Error('HTTPS proxy origin was lost');
 return true;
}
