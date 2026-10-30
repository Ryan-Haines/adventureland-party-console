// caracAL prints every game_logs entry of every character thread to stdout.
// The game sends each party event (a kill, a find) to every member's client,
// so a party of three printed each kill three times: 89% of the console log
// was kill and gold lines, measured live (docs/efficiency.md § Requests and logs).
//
// installGameLogEcho replaces caracAL's echo hook. A party kill or find goes to
// stdout only from the thread of the character it names, chosen by the event's
// phrase arguments. Each event still reaches add_log, so the console's own
// capture (gameLogs) sees every line as before.

import type { CharacterEntity, ServerToClient_game_log } from "typed-adventureland";

// typed-adventureland 0.0.57 types the object form of game_log with color and
// message only. Party kills and finds also carry phrase and phrase_args, which
// the game's game_log handler passes to phrase.message.
type GameLogEvent = Partial<Exclude<ServerToClient_game_log, string>> & {
  phrase?: unknown;
  phrase_args?: { player?: unknown };
};
interface EchoHost {
  add_log: (message: unknown, color?: string) => unknown;
  game_logs: [unknown, unknown][];
  character?: Pick<CharacterEntity, "name"> | null;
  phrase?: { message?: (data: unknown, html?: boolean) => unknown };
}
interface EchoLog { info(details: { col: unknown; type: "game_logs" }, message: unknown): void }

// The game sends these to the named player too (observed live: a killer's
// own thread logs "<killer> killed a Tiny Crab", a finder's "<finder> found a Seashell").
const namedPlayerPhrases = ["server.kill.player.", "server.item.named_found."];

/** The player a party kill or find names, or undefined for other events. */
function namedPlayer(data: GameLogEvent | null | undefined): string | undefined {
  const phrase = data?.phrase, player = data?.phrase_args?.player;
  if (typeof phrase !== "string" || typeof player !== "string") return undefined;
  return namedPlayerPhrases.some((prefix) => phrase.startsWith(prefix)) ? player : undefined;
}

/** Returns false when the game client has no phrase lookup; caracAL then keeps its own hook. */
export function installGameLogEcho(host: EchoHost, log: EchoLog, siblings: () => string[] | undefined): boolean {
  const phrase = host.phrase;
  if (!phrase || typeof phrase.message !== "function") return false;
  const message = phrase.message;
  // The rendered text of a sibling's event, until the add_log call it feeds.
  let quiet: unknown = null;
  phrase.message = function (data, html) {
    const rendered = message.call(this, data, html);
    if (siblingEvent(data as GameLogEvent)) {
      quiet = rendered;
      queueMicrotask(() => { quiet = null; });
    }
    return rendered;
  };
  function siblingEvent(data: GameLogEvent | null | undefined): boolean {
    const player = namedPlayer(data), self = host.character?.name;
    return !!player && !!self && player !== self && (siblings() || []).includes(player);
  }
  const original = host.add_log;
  host.add_log = function (text, color) {
    // The console capture adds a timestamp prefix before this call.
    const silent = typeof quiet === "string" && typeof text === "string" && text.endsWith(quiet);
    quiet = null;
    const before = host.game_logs.length;
    original(text, color);
    host.game_logs.forEach(([entry, col], index) => {
      if (!silent || index < before) log.info({ col, type: "game_logs" }, entry);
    });
    host.game_logs = [];
  };
  return true;
}
