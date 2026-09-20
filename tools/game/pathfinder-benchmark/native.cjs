const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const BASE = { h: 8, v: 7, vn: 2 };
function createNative(directory, hidden = false) {
  let seed = 42;
  const math = Object.create(Math);
  math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const forbidden = () => {
    throw new Error("Offline benchmark forbids movement, timers, and network");
  };
  const context = vm.createContext(
    {
      console: { log() {}, error() {} },
      Place: "client",
      Math: math,
      performance,
      character: { base: BASE },
      parent: {
        is_hidden: () => hidden,
        phrase: (x) => x,
        no_graphics: true,
        socket: { emit: forbidden },
      },
      game: { graphics: false },
      code_settings: { log_smart_move: false },
      game_log() {},
      move: forbidden,
      transport: forbidden,
      town: forbidden,
      fetch: forbidden,
      WebSocket: forbidden,
      setTimeout: forbidden,
      setInterval: forbidden,
      push_deferred: () => null,
      reject_deferreds() {},
      resolve_deferreds() {},
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  for (const file of ["data.js", "old_common_functions.js"])
    vm.runInContext(fs.readFileSync(path.join(directory, file), "utf8"), context, {
      timeout: 10000,
    });
  // The live game adds collision-bearing scenery here. Raw data.js is not the
  // geometry used by can_move or the browser's native planner.
  vm.runInContext("process_game_data();", context, { timeout: 10000 });
  const source = fs.readFileSync(path.join(directory, "runner_functions.js"), "utf8");
  // Exact installed declarations. Exclude the movement executor and runner timers.
  for (const [from, to] of [
    ["var smart =", "function smart_move_event"],
    ["function smart_move(destination", "function stop("],
    ["var queue =", "function smart_move_logic()"],
  ]) {
    const start = source.indexOf(from),
      end = source.indexOf(to, start);
    if (start < 0 || end < 0) throw new Error(`Native source layout changed: ${from}`);
    vm.runInContext(source.slice(start, end), context);
  }
  return {
    context,
    game: context.G,
    canWalk(a, b) {
      return (
        a.map === b.map &&
        context.can_move({ map: a.map, x: a.x, y: a.y, going_x: b.x, going_y: b.y, base: BASE })
      );
    },
    query(route, querySeed = 42, timeout = 30000) {
      seed = querySeed;
      context.input = route;
      vm.runInContext(
        `character.map=input.from.map; character.real_x=input.from.x; character.real_y=input.from.y;
        smart.use_town=!!input.town; smart.moving=false; smart_move(input.to);
        slices=0; maxSliceMs=0; began=performance.now();`,
        context,
      );
      let error;
      try {
        vm.runInContext(
          `do { var sliceStart=performance.now();
          if (!smart.searching) start_pathfinding(); else continue_pathfinding();
          slices++; maxSliceMs=Math.max(maxSliceMs,performance.now()-sliceStart);
        } while (smart.moving && !smart.found);`,
          context,
          { timeout },
        );
      } catch (e) {
        error = e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" ? "timeout" : e.message;
      }
      return {
        ms: performance.now() - context.began,
        slices: context.slices,
        maxSliceMs: context.maxSliceMs,
        error: error || (!context.smart.found ? "no-path" : null),
        path:
          error || !context.smart.found
            ? []
            : context.smart.plot.map((p) => ({
                map: p.map,
                x: p.x,
                y: p.y,
                method: p.town ? "town" : p.transport ? "transport" : "move",
                spawn: p.s,
              })),
      };
    },
  };
}
module.exports = { createNative, BASE };
