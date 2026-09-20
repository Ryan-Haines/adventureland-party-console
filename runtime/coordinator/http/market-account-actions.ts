import { createALDataRoutes, createMailPostageRoute } from "./aldata.ts";

type MarketState = Parameters<typeof createALDataRoutes>[0] & { nextCommandId: number };
type MarketPorts<Version> = Omit<
  Parameters<typeof createALDataRoutes>[1],
  "key" | "nextCommand" | "refresh"
> & {
  randomBytes: (size: number) => { toString: (encoding: "hex") => string };
  refresh: (kind: "all") => Promise<unknown>;
  versions: () => Promise<Version[]>;
  locate: (path: string, version: Version | undefined) => string;
  read: (path: string, encoding: "utf8") => Promise<string>;
  postage: (html: string) => number | null;
};

/** Account controls share command allocation; postage is read from the currently available game cache per request. */
export function createCoordinatorMarketAccountActions<Version>(
  state: MarketState,
  ports: MarketPorts<Version>,
) {
  const market = createALDataRoutes(state, {
    ...ports,
    key: () => ports.randomBytes(32).toString("hex"),
    nextCommand: () => state.nextCommandId++,
    refresh: () => ports.refresh("all"),
  });
  const postage = createMailPostageRoute(async () => {
    const versions = await ports.versions();
    const html = await ports.read(ports.locate("/js/html.js", versions[0]), "utf8");
    return ports.postage(html);
  });
  return { market, postage };
}
