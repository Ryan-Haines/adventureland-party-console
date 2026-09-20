import { buildDeconstructionCatalog } from "../merchant/deconstruction.ts";
import type { MapCatalog } from "../telemetry/maps.ts";

interface DataPorts {
  read(path: string): string;
  evaluate(source: string, context: object, filename?: string): unknown;
  warn(details: { error: unknown }, message: string): void;
}
const floorKeys: Record<string, { id: string; name: string } | undefined> = {
  bank_b: { id: "bkey", name: "The Bank Key" },
  bank_u: { id: "ukey", name: "The Bank Key" },
};
type VaultDefinitions = Record<string, [string, unknown, unknown]>;

/** Game files are executable server data; keep evaluation and filesystem access at the boundary. */
export function loadCoordinatorBankVaults(version: string | number, ports: DataPorts) {
  try {
    const source = ports.read("./game_files/" + version + "/old_common_functions.js");
    const match = source.match(/var bank_packs=(\{[\s\S]*?\});\s*var character_slots=/);
    if (!match) throw new Error("bank_packs definition was not found");
    const definitions = ports.evaluate(
      "(" + match[1] + ")",
      Object.create(null),
    ) as VaultDefinitions;
    return Object.entries(definitions)
      .map(([pack, definition]) => ({
        pack,
        floor: definition[0],
        gold: Number(definition[1]) || 0,
        shells: Number(definition[2]) || 0,
        key: floorKeys[definition[0]] || null,
      }))
      .sort((a, b) => Number(a.pack.replace(/\D/g, "")) - Number(b.pack.replace(/\D/g, "")));
  } catch (error) {
    ports.warn({ error }, "Could not load bank-vault definitions");
    return [];
  }
}

/** Cache successful loads, including an empty catalog; failed reads/evaluations remain retryable. */
export function createCoordinatorGameData(
  directory: string,
  version: string | number,
  ports: DataPorts,
) {
  let data: MapCatalog | null = null;
  function load(): MapCatalog {
    if (data) return data;
    const source = ports.read(directory + "/../game_files/" + version + "/data.js");
    const sandbox: { G?: MapCatalog } = {};
    ports.evaluate(source, sandbox, "game_files/" + version + "/data.js");
    data = sandbox.G || {};
    return data;
  }
  return { load };
}

export function loadCoordinatorDeconstructionCatalog(version: string | number, ports: DataPorts) {
  try {
    const context: { G?: Parameters<typeof buildDeconstructionCatalog>[0] } = {};
    ports.evaluate(ports.read("./game_files/" + version + "/data.js"), context);
    return buildDeconstructionCatalog(context.G || {});
  } catch (error) {
    ports.warn({ error }, "Deconstruction catalog unavailable; deconstruction disabled");
    return {};
  }
}
