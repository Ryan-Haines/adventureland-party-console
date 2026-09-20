import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildGame } from "./build.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
let pending = false;
let running = false;
let closed = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function typecheck(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/typescript/bin/tsc", "-p", "runtime/tsconfig.json"],
      {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Runtime typecheck failed")),
    );
  });
}
async function rebuild(): Promise<void> {
  if (running || closed) return;
  running = true;
  try {
    while (pending && !closed) {
      pending = false;
      try {
        await typecheck();
        await buildGame(root, true);
      } catch (error) {
        console.error("Game update rejected; previous generation retained.", error);
      }
    }
  } finally {
    running = false;
  }
}
function changed(): void {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 250);
}
const watchers = ["runtime/characters", "dashboard/lib"].map((directory) =>
  watch(
    new URL(directory + "/", new URL("../../", import.meta.url)),
    { recursive: true },
    (_event, filename) => {
      if (filename?.endsWith(".ts")) changed();
    },
  ),
);
// Transitional source dependency; generated output files are never watched.
watchers.push(watch(new URL("../../characters/shared.js", import.meta.url), changed));
function close(): void {
  closed = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
changed();
console.log("Watching TypeScript character sources; only verified generations are published.");
