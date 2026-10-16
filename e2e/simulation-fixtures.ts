import { test as base, expect } from "@playwright/test";
import { fork } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { environment, stop } from "./fixtures";
import { loadouts } from "./game/loadouts";
import type { GameplayWorld } from "./gameplay-clock";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Reply = {
  id?: number;
  type?: string;
  out?: string;
  now: number;
  value?: unknown;
  error?: string;
};
type Summary = { log: { error: number }; httpErrors: number; virtualMs: number; wallMs: number };
export const test = base.extend<{ gameplay: GameplayWorld; simulationClass: "warrior" | "ranger" }>(
  {
    simulationClass: ["warrior", { option: true }],
    gameplay: [
      async ({ simulationClass }, use, info) => {
        const directory = path.join(root, ".build/e2e", `simulation-${randomUUID()}`);
        mkdirSync(directory, { recursive: true });
        const scenario = path.join(directory, "scenario.json"),
          log = path.join(directory, "process.log");
        writeFileSync(
          scenario,
          JSON.stringify({
            seed: 1,
            threads: true,
            realm: "SR_USI",
            minutes: 30,
            sampleSeconds: 30,
            initialLoadout: loadouts.god,
            merchant: "E2EMerchant",
            characters: [
              { name: "E2EWarrior", type: simulationClass, level: 80 },
              { name: "E2EPriest", type: "priest", level: 80 },
              { name: "E2EMerchant", type: "merchant", level: 80 },
            ],
          }),
        );
        const child = fork(path.join(root, "tools/sim/run.cjs"), [scenario], {
          cwd: root,
          env: environment({ SIM_E2E_IPC: "1" }),
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout!.on("data", (bytes) => appendFileSync(log, bytes));
        child.stderr!.on("data", (bytes) => appendFileSync(log, bytes));
        let now = 0,
          out: string | undefined,
          next = 0;
        const pending = new Map<
          number,
          { resolve: (value: unknown) => void; reject: (error: Error) => void }
        >();
        const ready = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Simulation IPC startup timed out")), 120000);
          child.on("message", (reply: Reply) => {
            now = reply.now;
            if (reply.type === "sim-ready") {
              out = reply.out;
              clearTimeout(timer);
              resolve();
              return;
            }
            const request = pending.get(reply.id!);
            if (!request) return;
            pending.delete(reply.id!);
            if (reply.error) request.reject(new Error(reply.error));
            else request.resolve(reply.value);
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", (code) => {
            clearTimeout(timer);
            const error = Error(`Simulation exited (${code}); see process.log`);
            reject(error);
            for (const request of pending.values()) request.reject(error);
            pending.clear();
          });
        });
        async function call<T = unknown>(
          action: string,
          body: Record<string, unknown> = {},
        ): Promise<T> {
          const id = ++next;
          return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(Error(`Simulation ${action} timed out`));
            }, 30000);
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value as T);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            });
            child.send({ id, action, ...body }, (error) => {
              if (error) {
                clearTimeout(timer);
                pending.delete(id);
                reject(error);
              }
            });
          });
        }
        const clients: GameplayWorld["clients"] = {};
        for (const name of ["E2EWarrior", "E2EPriest", "E2EMerchant"])
          clients[name] = {
            run: (expression) => call("run", { name, expression }),
            events: () => call("run", { name, expression: "parent.__simEvents" }),
            snapshot: () =>
              call("run", {
                name,
                expression:
                  "({name:character.name,map:character.map,x:character.real_x,y:character.real_y,hp:character.hp,rip:character.rip})",
              }),
          };
        const gameplay: GameplayWorld = {
          clients,
          now: () => now,
          advance: async (ms) => {
            await call("advance", { ms });
          },
          state: (catalogs) => call("state", { catalogs }),
          post: (route, body) => call("post", { route, body }),
          admin: (code) => call("admin", { code }),
        };
        try {
          await ready;
          const seed = await gameplay.admin(
            `output=Object.values(players).map(p=>({name:p.name,owner:p.owner,type:p.type,level:p.level,slots:p.slots,hp:p.hp,mp:p.mp,attack:p.attack,speed:p.speed}))`,
          );
          expect(seed.map((p: { name: string }) => p.name).sort()).toEqual(
            Object.keys(clients).sort(),
          );
          for (const actor of seed) {
            expect(actor.level).toBe(80);
            expect(actor.type).toBe(
              actor.name === "E2EWarrior"
                ? simulationClass
                : actor.name === "E2EPriest"
                  ? "priest"
                  : "merchant",
            );
            expect(actor.slots.mainhand.level).toBe(loadouts.god.weaponLevel);
            for (const [slot, item] of Object.entries(loadouts.god.armor))
              expect(actor.slots[slot]).toMatchObject(item);
          }
          await info.attach("native-loadout-seed", {
            body: JSON.stringify(seed),
            contentType: "application/json",
          });
          await use(gameplay);
          const summary = await call<Summary>("close");
          expect(summary.log.error, "No virtual-clock coordinator/CODE errors").toBe(0);
          expect(summary.httpErrors, "No lost simulation transport requests").toBe(0);
        } finally {
          await stop(child);
          const files = [
            log,
            scenario,
            ...(out ? readdirSync(out).map((file) => path.join(out!, file)) : []),
          ];
          for (const file of files) {
            const destination = info.outputPath(path.basename(file));
            copyFileSync(file, destination);
            await info.attach(path.basename(file), {
              path: destination,
              contentType: file.endsWith(".json") ? "application/json" : "text/plain",
            });
          }
        }
      },
      { timeout: 180000 },
    ],
  },
);
export { expect };
