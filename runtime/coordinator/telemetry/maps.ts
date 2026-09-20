export interface MapGeometry {
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default?: number;
  tiles?: readonly (readonly (string | number)[] | null)[];
  placements?: readonly unknown[];
  groups?: readonly unknown[];
}

export interface MapCatalog {
  geometry?: Readonly<Record<string, MapGeometry | undefined>>;
  tilesets?: Readonly<Record<string, { file?: string } | undefined>>;
}

export interface MapDefinition {
  name: string;
  min_x?: number;
  min_y?: number;
  max_x?: number;
  max_y?: number;
  default: number | null;
  tiles: NonNullable<MapGeometry["tiles"]>;
  placements: readonly unknown[];
  groups: readonly unknown[];
  tilesets: Record<string, { file: string }>;
}

function tilesetsFor(geometry: MapGeometry, catalog: MapCatalog): MapDefinition["tilesets"] {
  const used = new Set((geometry.tiles || []).map((tile) => tile?.[0]).filter(Boolean));
  const tilesets: MapDefinition["tilesets"] = {};
  for (const id of used) {
    const definition = catalog.tilesets?.[String(id)];
    if (definition?.file)
      tilesets[String(id)] = { file: "https://adventure.land" + definition.file };
  }
  return tilesets;
}

function describeMap(name: string, geometry: MapGeometry, catalog: MapCatalog): MapDefinition {
  return {
    name,
    min_x: geometry.min_x,
    min_y: geometry.min_y,
    max_x: geometry.max_x,
    max_y: geometry.max_y,
    default: Number.isInteger(geometry.default) ? Number(geometry.default) : null,
    tiles: geometry.tiles || [],
    placements: geometry.placements || [],
    groups: geometry.groups || [],
    tilesets: tilesetsFor(geometry, catalog),
  };
}

/** An eight-entry insertion-order cache, matching the coordinator's existing eviction policy. */
export function createMapDefinitions(load: () => MapCatalog) {
  const cache = new Map<string, MapDefinition>();
  return {
    get(name: string): MapDefinition | null {
      const cached = cache.get(name);
      if (cached) return cached;
      const catalog = load();
      const geometry = catalog.geometry?.[name];
      if (!geometry) return null;
      const result = describeMap(name, geometry, catalog);
      cache.set(name, result);
      const oldest = cache.keys().next();
      if (cache.size > 8 && !oldest.done) cache.delete(oldest.value);
      return result;
    },
  };
}
