export const updaterProtocol = 1;
export interface Release {
  version: string;
  repository: string;
  commit: string;
  protocol: number;
  dataFormat: number;
  files: Record<string, string>;
}
export interface PublishedRelease {
  version: string;
  protocol: number;
  dataFormat: number;
  windows: { asset: string; sha256: string };
  image: string;
}
export interface UpdateStatus {
  current: string;
  displayVersion?: string;
  available?: string;
  notes?: string;
  automatic: boolean;
  managed: boolean;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'restarting' | 'blocked' | 'failed';
  checkedAt?: number;
  error?: string;
}
export function version(value: unknown): number[] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('A stable semantic version is required');
  const result = value.split('.').map(Number);
  if (result.some(n => !Number.isSafeInteger(n))) throw new Error('Invalid version');
  return result;
}
export function newer(candidate: string, current: string): boolean {
  const a = version(candidate), b = version(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function repository(value: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Configure the GitHub owner/repository before publishing');
  return value;
}
export function published(value: unknown, repo: string, expected: string): PublishedRelease {
  const entry = value as PublishedRelease;
  if (!entry || entry.version !== expected || entry.protocol !== updaterProtocol || entry.dataFormat !== 1)
    throw new Error('This release requires a manual installer or data-format upgrade');
  version(entry.version);
  validateWindows(entry.windows, expected);
  const prefix = `ghcr.io/${repository(repo).toLowerCase()}@sha256:`;
  if (!entry.image?.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(entry.image.slice(prefix.length))) throw new Error('Invalid release image digest');
  return entry;
}
function validateWindows(value: PublishedRelease['windows'], expected: string) {
  if (value?.asset !== `adventureland-party-console-${expected}-windows-x64.zip` || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('Invalid Windows release asset');
}
