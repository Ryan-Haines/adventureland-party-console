import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
export const token = () => randomBytes(32).toString("hex");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface Credentials {
  requirePairing: boolean;
  browsers: string[];
  steam: string[];
  pairing: string | null;
}
export class Access {
  private state: Credentials = { requirePairing: false, browsers: [], steam: [], pairing: null };
  private file: string;
  private writes: Promise<void> = Promise.resolve();
  constructor(file: string) {
    this.file = file;
  }
  async load() {
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
      // Legacy access files were always protected, including unused invitations.
      this.state.requirePairing ??= !!(this.state.browsers.length || this.state.steam.length || this.state.pairing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  get required() { return this.state.requirePairing; }
  async setRequired(required: boolean) {
    const credential = required ? token() : undefined;
    if (credential) this.state.browsers.push(hash(credential));
    this.state.requirePairing = required;
    await this.save();
    return credential;
  }
  private async save() {
    const snapshot = JSON.stringify(this.state);
    this.writes = this.writes.then(async () => {
      await writeFile(this.file + ".tmp", snapshot, { mode: 0o600 });
      await rename(this.file + ".tmp", this.file);
    });
    await this.writes;
  }
  async invitation() {
    const value = token();
    this.state.pairing = hash(value);
    await this.save();
    return value;
  }
  async pair(value: string) {
    if (!value || hash(value) !== this.state.pairing)
      throw new Error("Pairing link is invalid or already used");
    this.state.pairing = null;
    return this.browserCredential();
  }
  /** Issue only after an invitation or an authenticated setup transfer was verified. */
  async browserCredential() {
    const credential = token();
    this.state.browsers.push(hash(credential));
    await this.save();
    return credential;
  }
  valid(kind: "browsers" | "steam", value: string) {
    return !!value && this.state[kind].includes(hash(value));
  }
  async steam() {
    const credential = token();
    this.state.steam.push(hash(credential));
    await this.save();
    return credential;
  }
  async revokeSteam() {
    this.state.steam = [];
    await this.save();
  }
}
