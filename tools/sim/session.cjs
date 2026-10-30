"use strict";
// Interactive Playwright boundary: commands serialize; only explicit advances move virtual time.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
async function serveSession(o) {
  const { sim, api, waitFor, out, counts, transport, characters } = o;
  const start = sim.clock.now,
    realStart = performance.now();
  const ledger = fs.openSync(path.join(out, "session.jsonl"), "a");
  const client = (name) => {
    const value = sim.clients.find((c) => c.name === name);
    if (!value) throw new Error(`Unknown simulation client ${name}`);
    return value;
  };
  const actions = {
    async state({ catalogs }) {
      const r = await waitFor(api("GET", catalogs ? "/state" : "/state?catalog=0"));
      if (r.status !== 200) throw new Error(`State returned ${r.status}`);
      return r.body;
    },
    async post({ route, body }) {
      const r = await waitFor(api("POST", route, body));
      if (r.status >= 400) throw new Error(`${route}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
    async admin({ code }) {
      const value = vm.runInContext(`${code};output`, sim.server, { timeout: 5000 });
      return waitFor(Promise.resolve(value));
    },
    async run({ name, expression }) {
      const c = client(name);
      if (c.queryCode) return c.queryCode(expression);
      const worker = sim.workers.find((w) => w.name === name);
      worker.cmd({ t: "code", expr: expression });
      const result = worker.wait();
      if (result.err) throw new Error(result.err);
      return result.value;
    },
    async advance({ ms }) {
      if (!Number.isFinite(ms) || ms < 0 || ms > 10000)
        throw new Error("Invalid bounded clock advance");
      await sim.run(ms);
      return null;
    },
  };
  // Current actors and catalog must exist before a scenario can make assertions.
  let ready = false;
  const deadline = sim.clock.now + 90000;
  while (sim.clock.now < deadline && !ready) {
    await sim.run(250);
    const state = await actions.state({ catalogs: true });
    ready =
      characters.every((c) => state.characters?.[c.name]?.seenAt > 0) &&
      state.monsterChoices?.length > 0;
  }
  if (!ready) throw new Error("Simulation E2E bootstrap missing native actors/catalog");
  process.send({ type: "sim-ready", out, now: sim.clock.now, game: sim.server.G.version });
  await new Promise((resolve, reject) => {
    let queue = Promise.resolve();
    process.on("message", (message) => {
      queue = queue
        .then(async () => {
          try {
            let value;
            if (message.action === "close") {
              const state = await actions.state({ catalogs: true });
              value = {
                schema: 1,
                pins: require("./pins.json"),
                codeGeneration: JSON.parse(
                  fs.readFileSync(path.join(o.runDir, "CODE/adventure_land/manifest.json"), "utf8"),
                ).generation,
                coordinatorSha256: createHash("sha256")
                  .update(
                    fs.readFileSync(
                      path.join(o.root, ".build/runtime/coordinator-application.cjs"),
                    ),
                  )
                  .digest("hex"),
                virtualMs: sim.clock.now - start,
                wallMs: performance.now() - realStart,
                game: sim.server.G.version,
                log: counts,
                httpErrors: transport.stats.errors,
                characters: characters.map((c) => c.name),
                state,
              };
              fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(value, null, 2));
            } else {
              if (!actions[message.action]) throw new Error("Unsupported simulation command");
              value = await actions[message.action](message);
            }
            const response = { id: message.id, value, now: sim.clock.now };
            fs.writeSync(
              ledger,
              JSON.stringify({
                request: message,
                action: message.action,
                id: message.id,
                now: sim.clock.now,
                valueSha256: createHash("sha256")
                  .update(JSON.stringify(value) ?? "undefined")
                  .digest("hex"),
              }) + "\n",
            );
            process.send(response);
            if (message.action === "close") resolve();
          } catch (error) {
            const failure = {
              id: message.id,
              error: String(error.stack || error),
              now: sim.clock.now,
            };
            fs.writeSync(ledger, JSON.stringify({ action: message.action, ...failure }) + "\n");
            process.send(failure);
          }
        })
        .catch(reject);
    });
    process.once("disconnect", resolve);
  });
}
module.exports = { serveSession };
