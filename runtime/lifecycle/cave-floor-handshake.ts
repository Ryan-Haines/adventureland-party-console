// The game server strips tiles, placements, groups and animations from every
// generated Cave floor it sends to a socket whose handshake says no_graphics=1
// (adventureland_mongodb node/logic/generated_maps.js send_generated_maps).
// Every caracAL worker connects that way, so a headless party has no Cave
// floor art for the dashboard map. Only the party leader's worker reports
// no_graphics=0 at connect time. window.no_graphics stays true, so the client
// still draws nothing; the server reads the flag only for Cave floor delivery
// and for observer broadcasts, which also need broadcast=1 in the query.
// The flag is fixed for the socket: a leader chosen after the worker started
// receives full floors after its next reconnect or console restart.
type Options = { query?: unknown } & Record<string, unknown>;
type Connect = (url: unknown, options?: Options) => unknown;

/** Rewrites only no_graphics in the socket.io handshake query. */
export function fullCaveFloorOptions(options: Options | undefined): Options | undefined {
  const query = options?.query;
  if (typeof query === "string")
    return { ...options, query: query.replace(/(^|&)no_graphics=1(?=&|$)/, "$1no_graphics=0") };
  if (query && typeof query === "object" && (query as Record<string, unknown>).no_graphics === "1")
    return { ...options, query: { ...(query as Record<string, unknown>), no_graphics: "0" } };
  return options;
}

/** Wraps the worker's socket.io factory before the game's first init_socket(). */
export function installCaveFloorHandshake(game: { io?: unknown }, leader: boolean): boolean {
  if (!leader || typeof game.io !== "function") return false;
  const connect = game.io as Connect;
  const wrapped = function (this: unknown, url: unknown, options?: Options) {
    return connect.call(this, url, fullCaveFloorOptions(options));
  };
  // socket.io-client exposes Manager, Socket, io and connect on the factory.
  game.io = Object.assign(wrapped, connect);
  return true;
}
