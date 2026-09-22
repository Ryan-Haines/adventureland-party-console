import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
export async function trustHelper(pem: string, platform: 'windows' | 'linux') {
 const certificate = new X509Certificate(pem);
 const file = platform === 'windows' ? './trust-windows.ps1' : './trust-linux.sh';
 const script = (await readFile(new URL(file, import.meta.url), 'utf8'))
  .replaceAll('__CERT_BASE64__', platform === 'windows' ? certificate.raw.toString('base64') : Buffer.from(pem).toString('base64'))
  .replaceAll('__FINGERPRINT__', certificate.fingerprint256)
  .replaceAll('__ID__', certificate.fingerprint256.replaceAll(':', '').toLowerCase());
 if (platform === 'linux') return script;
 const encoded = Buffer.from(script, 'utf16le').toString('base64');
 const bootstrap = "$ErrorActionPreference = 'Stop'; $line = [IO.File]::ReadAllLines($env:PARTY_TRUST_HELPER) | Select-Object -Last 1; & ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($line.Substring('::PARTY_PAYLOAD::'.Length)))))";
 return ['@echo off', 'setlocal', 'title Party Console certificate setup', 'set "PARTY_TRUST_REMOVE=%~1"', 'set "PARTY_TRUST_HELPER=%~f0"',
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -OutputFormat Text -EncodedCommand ${Buffer.from(bootstrap, 'utf16le').toString('base64')}`,
  'set "result=%errorlevel%"', 'echo.',
  'if not "%result%"=="0" echo Certificate setup failed. Read the error above.',
  'pause', 'exit /b %result%', `::PARTY_PAYLOAD::${encoded}`].join('\r\n');
}
