import { watch } from "node:fs";
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
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
const polling = process.env.AL_WATCH_POLL === '1';
const directories = ['runtime/characters', 'dashboard/lib'];
const watchers = polling ? [] : directories.map((directory) =>
  watch(
    new URL(directory + "/", new URL("../../", import.meta.url)),
    { recursive: true },
    (_event, filename) => {
      if (filename?.endsWith(".ts")) changed();
    },
  ),
);
// Transitional source dependency; generated output files are never watched.
if (!polling) watchers.push(watch(new URL("../../characters/shared.js", import.meta.url), changed));
let snapshot = '';
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
async function poll(): Promise<void> {
  try {
    const files = ['characters/shared.js'];
    for (const directory of directories) {
      const names = await readdir(path.join(root, directory), { recursive: true });
      files.push(...names.filter(name => name.endsWith('.ts')).map(name => path.join(directory, name)));
    }
    const values = await Promise.all(files.sort().map(async name => {
      const info = await stat(path.join(root, name));
      return `${name}:${info.mtimeMs}:${info.size}`;
    }));
    const next = values.join('\n');
    if (snapshot && snapshot !== next) changed();
    snapshot = next;
  } catch (error) { console.error('Character source polling failed:', error); }
  if (!closed) pollingTimer = setTimeout(() => void poll(), 1000);
}
if (polling) void poll();
function close(): void {
  closed = true;
  clearTimeout(timer);
  clearTimeout(pollingTimer);
  for (const watcher of watchers) watcher.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
changed();
console.log("Watching TypeScript character sources; only verified generations are published.");
