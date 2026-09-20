import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "../../dashboard/node_modules/vite/dist/node/index.js";
import { withBuildLock } from '../build-store.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");
process.chdir(root);
process.env.AL_DASHBOARD_OUT_DIR ||= ".build/validation";
// Vinext's CLI always cleans dashboard/dist. Use Vite's application builder
// directly so a build cannot remove files used by the active server.
await withBuildLock(path.join(root, '.build'), async () => {
const builder = await createBuilder({
  root,
  configFile: path.join(root, "vite.config.ts"),
  mode: "production",
});
await builder.buildApp();
});
