import { createDashboardImportRoutes } from "./dashboard-import.ts";
import type { HttpRequest } from "./contracts.ts";

interface ImportCompositionPorts {
  rosterReady?(): boolean;
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
}

/** Bind preview identity and exclusive backups to the installation's actual storage file. */
export function createCoordinatorDashboardImport(
  state: Record<string, unknown>,
  storagePath: string,
  ports: ImportCompositionPorts,
) {
  return createDashboardImportRoutes(state, {
    rosterReady: () => ports.rosterReady?.() ?? true,
    owned: (name) => !!ports.owned(name),
    digest: (source) => ports.crypto.createHash("sha256").update(source).digest("hex"),
    previewDigest: (request) => ports.header(request, "X-State-Preview"),
    canonicalPath: () => ports.files.realpathSync(storagePath),
    backup: (destination) =>
      ports.files.copyFileSync(storagePath, destination, ports.files.constants.COPYFILE_EXCL),
    suffix: () => ports.now() + "-" + ports.crypto.randomBytes(4).toString("hex"),
    persist: ports.persist,
  });
}
