import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
export async function trustHelper(pem: string, platform: 'windows' | 'linux') {
 const certificate = new X509Certificate(pem);
 const file = platform === 'windows' ? './trust-windows.ps1' : './trust-linux.sh';
 return (await readFile(new URL(file, import.meta.url), 'utf8'))
  .replaceAll('__CERT_BASE64__', platform === 'windows' ? certificate.raw.toString('base64') : Buffer.from(pem).toString('base64'))
  .replaceAll('__FINGERPRINT__', certificate.fingerprint256)
  .replaceAll('__ID__', certificate.fingerprint256.replaceAll(':', '').toLowerCase());
}
