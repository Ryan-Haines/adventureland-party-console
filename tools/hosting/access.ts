import { randomBytes, randomInt, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
export const token = () => randomBytes(32).toString("hex");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
// The alphabet leaves out 0/O and 1/I/L so a code survives being read off another screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const ACCESS_CODE_TTL_MS = 10 * 60_000;
export const ACCESS_CODE_ATTEMPTS = 5;
/** Accepts the code as typed: any case, with or without the dash and spaces. */
export const accessCodeValue = (value: string) => value.toUpperCase().replace(/[\s-]/g, "");
interface Credentials {
  requirePairing: boolean;
  browsers: string[];
  steam: string[];
  pairing: string | null;
}
interface AccessCode {
  hash: string;
  expiresAt: number;
  failures: number;
}
export class Access {
  private state: Credentials = { requirePairing: false, browsers: [], steam: [], pairing: null };
  // The access code lives only in memory, so a console restart cancels it.
  private code: AccessCode | null = null;
  private file: string;
  private writes: Promise<void> = Promise.resolve();
  private now: () => number;
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
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
    // One invitation pairs one browser, so its access code goes with the link.
    this.state.pairing = null;
    this.code = null;
    return this.browserCredential();
  }
  /** Replaces any earlier code: only the newest one can pair a browser. */
  accessCode() {
    const value = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    this.code = { hash: hash(value), expiresAt: this.now() + ACCESS_CODE_TTL_MS, failures: 0 };
    return { code: value.slice(0, 4) + "-" + value.slice(4), expiresAt: this.code.expiresAt, expiresIn: ACCESS_CODE_TTL_MS };
  }
  /** When the active code expires, or null once it is used, expired or cancelled. */
  get accessCodeExpiry() {
    return this.activeCode()?.expiresAt ?? null;
  }
  private activeCode() {
    if (this.code && this.now() >= this.code.expiresAt) this.code = null;
    return this.code;
  }
  async pairCode(value: string) {
    const code = this.activeCode();
    if (!code) throw new Error("Access code is invalid or expired");
    if (!sameHash(hash(accessCodeValue(value)), code.hash)) {
      // Each wrong guess counts against the code, and the last allowed one cancels it.
      if (++code.failures >= ACCESS_CODE_ATTEMPTS) this.code = null;
      throw new Error("Access code is invalid or expired");
    }
    this.code = null;
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
