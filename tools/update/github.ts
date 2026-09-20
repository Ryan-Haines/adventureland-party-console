import { published, repository, version, type PublishedRelease } from './contracts.ts';
import { digest } from './files.ts';

async function githubFetch(url: string, headers: Record<string, string> = {}, timeout = 15000, allowMissing = false) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Adventureland-Party-Console', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok && response.status !== 304 && !(allowMissing && response.status === 404)) throw new Error(`GitHub update check failed (${response.status}); your installed version remains available`);
  return response;
}
export class GitHubReleases {
  readonly repo: string;
  private etag = '';
  private cached: { version: string; notes: string } | null = null;
  constructor(repo: string) { this.repo = repository(repo); }
  async latest() {
    const response = await githubFetch(`https://api.github.com/repos/${this.repo}/releases/latest`, this.etag ? { 'If-None-Match': this.etag } : {}, 15000, true);
    if (response.status === 404) { this.etag = ''; return this.cached = null; }
    if (response.status === 304) return this.cached;
    const release = await response.json() as { tag_name: string; draft: boolean; prerelease: boolean };
    if (release.draft || release.prerelease) return null;
    const tag = release.tag_name;
    if (!tag?.startsWith('v')) throw new Error('Release tag must start with v');
    version(tag.slice(1));
    this.etag = response.headers.get('etag') || '';
    return this.cached = { version: tag.slice(1), notes: `https://github.com/${this.repo}/releases/tag/${tag}` };
  }
  async manifest(tag: string): Promise<PublishedRelease> {
    version(tag);
    const response = await githubFetch(this.url(tag, 'release-manifest.json'));
    return published(await response.json(), this.repo, tag);
  }
  url(tag: string, asset: string) { return `https://github.com/${this.repo}/releases/download/v${tag}/${asset}`; }
  async download(manifest: PublishedRelease): Promise<Uint8Array> {
    const response = await githubFetch(this.url(manifest.version, manifest.windows.asset), {}, 600000);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (digest(bytes) !== manifest.windows.sha256) throw new Error('Downloaded update failed SHA-256 verification');
    return bytes;
  }
}
