import { requestObject, type HttpRequest, type HttpResponse } from "../../../lifecycle/api.ts";
import type { SettingsWrite, SettingsWriteResult } from "../../api.ts";
import type { HookRegistry } from "../../../hooks/registry.ts";
import {
  parseDashboardImport,
  exportDashboardSettings,
  applyDashboardImport,
  importedPrevious,
  IMPORT_MAX_BYTES,
  type AddonSettings,
  type DashboardImport,
} from "../persistence/dashboard-import.ts";

interface ImportPorts {
  rosterReady?(): boolean;
  owned(name: string): boolean;
  digest(source: string): string;
  previewDigest(req: HttpRequest): unknown;
  canonicalPath(): string;
  backup(path: string): void;
  suffix(): string;
  persist(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
  // The installed add-ons and their settings, whose importable ones the export and import carry.
  addons?(): AddonSettings;
  // The import's applied fields and characters, for `settings.imported`.
  imported?(applied: { fields: string[]; characters: string[]; skippedCharacters: Record<string, string[]> }): void;
}
type State = Record<string, unknown>;
export function createDashboardImportRoutes(state: State, ports: ImportPorts) {
  function metadata(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({
      filename: "caraGarage.jsonl",
      canonicalPath: ports.canonicalPath(),
      localPath: "<installation>/.caracal/localStorage/caraGarage.jsonl",
      dockerPath: "/data/localStorage/caraGarage.jsonl",
      maxBytes: IMPORT_MAX_BYTES,
    });
  }
  // A failed apply puts back the value every changed field held before it, settings and records
  // alike, by assignment as b9b5c91e restored them, and answers the cause.
  function apply(parsed: DashboardImport, backupPath: string): "saved" | { failed: string } | SettingsWriteResult & { ok: false } {
    const previous = importedPrevious(state, parsed);
    try {
      const refused = applyDashboardImport(state, parsed, ports.write);
      if (refused) return refused;
      ports.persist();
      ports.imported?.({ fields: parsed.fields, characters: parsed.characters, skippedCharacters: parsed.skippedCharacters ?? {} });
      return "saved";
    } catch (error) {
      Object.assign(state, previous);
      // The coordinator's log names the cause, as the persistence's own history save does.
      console.error("Settings import failed; previous settings restored in memory. Backup: " + backupPath, error);
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  }
  function handle(req: HttpRequest, res: HttpResponse, preview: boolean): unknown {
    try {
      if (ports.rosterReady && !ports.rosterReady()) throw new Error('Account roster is still loading; retry the import shortly');
      const source = req.body as string,
        parsed = parseDashboardImport(source, (name) => ports.owned(name), ports.addons?.() ?? []),
        digest = ports.digest(JSON.stringify({ source, parsed }));
      const summary = { fields: parsed.fields, characters: parsed.characters, skippedCharacters: parsed.skippedCharacters, digest };
      if (preview) return res.json(summary);
      if (!parsed.fields.length) throw new Error('Nothing to import: all saved characters were skipped');
      if (ports.previewDigest(req) !== digest)
        return res.status(409).json({ error: "Preview this file before importing it" });
      const backupPath = ports
        .canonicalPath()
        .replace(/\.jsonl$/, ".before-import-" + ports.suffix() + ".jsonl");
      ports.backup(backupPath);
      const applied = apply(parsed, backupPath);
      if (typeof applied === "object" && "failed" in applied)
        return res.status(500).json({ error: "Import could not be saved (" + applied.failed + "); previous settings restored in memory. Backup: " + backupPath });
      if (typeof applied === "object") return res.status(400).json({ error: applied.error, field: applied.field });
      return res.json({ ok: true, ...summary, backupPath });
    } catch (error) {
      return res
        .status(400)
        .json({ error: requestObject(error).message || "Invalid dashboard state file" });
    }
  }
  return {
    metadata,
    exportState: (_req: HttpRequest, res: HttpResponse) => res.json(exportDashboardSettings(state, ports.addons?.() ?? [])),
    // The two account preferences, written as one batch through the settings writer, whose
    // declared checks refuse a bad value before either is written.
    // Each declaration's refusal line holds the route's words
    // (status/fields.ts).
    preferences: (req: HttpRequest, res: HttpResponse) => {
      const body = requestObject(req.body);
      const written = ports.write({ by: "dashboard:preferences", changes: (["bankboiPrefix", "anniversaryAutoChat"] as const)
        .filter(field => body[field] !== undefined).map(field => ({ field, value: body[field] })) });
      if (!written.ok) return res.status(400).json({ error: written.error });
      return res.json({ ok: true });
    },
    preview: (req: HttpRequest, res: HttpResponse) => handle(req, res, true),
    importState: (req: HttpRequest, res: HttpResponse) => handle(req, res, false),
  };
}


interface ImportCompositionPorts {
  // The roster the dashboard shows; an import waits until it has a character.
  roster(): readonly unknown[];
  owned: (name: string) => unknown;
  crypto: {
    createHash: (algorithm: string) => {
      update: (source: string) => { digest: (encoding: "hex") => string };
    };
    randomBytes: (size: number) => { toString: (encoding: "hex") => string };
  };
  files: {
    realpathSync: (path: string) => string;
    copyFileSync: (source: string, destination: string, mode: number) => void;
    constants: { COPYFILE_EXCL: number };
  };
  header: (request: HttpRequest, name: string) => unknown;
  now: () => number;
  persist: () => void;
  write: (batch: SettingsWrite) => SettingsWriteResult;
  // The installed add-ons the export and import carry, and the notice of an applied import.
  hooks: Pick<HookRegistry, 'registrations' | 'notify'>;
}

/** Bind preview identity and exclusive backups to the installation's actual storage file. */
export function createCoordinatorDashboardImport(
  state: Record<string, unknown>,
  storagePath: string,
  ports: ImportCompositionPorts,
) {
  return createDashboardImportRoutes(state, {
    rosterReady: () => ports.roster().length > 0,
    owned: (name) => !!ports.owned(name),
    digest: (source) => ports.crypto.createHash("sha256").update(source).digest("hex"),
    previewDigest: (request) => ports.header(request, "X-State-Preview"),
    canonicalPath: () => ports.files.realpathSync(storagePath),
    backup: (destination) =>
      ports.files.copyFileSync(storagePath, destination, ports.files.constants.COPYFILE_EXCL),
    suffix: () => ports.now() + "-" + ports.crypto.randomBytes(4).toString("hex"),
    persist: ports.persist,
    write: ports.write,
    addons: () => ports.hooks.registrations().filter(r => r.folder === "addons"),
    imported: applied => ports.hooks.notify("settings.imported", { ...applied, by: "import" }),
  });
}
