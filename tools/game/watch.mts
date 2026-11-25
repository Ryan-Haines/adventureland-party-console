import { watch } from "node:fs";
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildGame } from "./build.mts";
import type { GameManifest } from "./manifest.ts";
import { gameStore } from "./history.ts";
import { readJson } from "../build-store.ts";
import { lifecycleSavedFields } from '../../runtime/lifecycle/fields.ts';

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
        learn(await buildGame(root, true));
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
  timer = setTimeout(() => void rebuild(), lifecycleSavedFields.settings.gameWatchMs.default);
}
const polling = process.env.AL_WATCH_POLL === '1';
// The watched sources are the files the last build's class bundles read (manifest classes[*].inputs,
// build.mts), so an edit to any owner module a bundle imports rebuilds. The published manifest seeds
// them at start and each build replaces them. characters/shared.js stays a source dependency that
// no bundle imports. Each folder watched is the deepest one that holds every input sharing its top
// folder, so runtime/ is watched whole and dashboard/ only at lib/.
let inputs: Set<string> | undefined;
const watchers = new Map<string, ReturnType<typeof watch>>();
function folderOf(files: string[]): string {
  const parts = files.map(file => path.posix.dirname(file).split('/'));
  let depth = 0;
  while (parts.every(part => part[depth] !== undefined && part[depth] === parts[0][depth])) depth++;
  return parts[0].slice(0, depth).join('/');
}
function learn(manifest: GameManifest): void {
  const files = Object.values(manifest.classes).flatMap(entry => entry.inputs).map(file => file.replaceAll('\\', '/'))
    .filter(file => !/^(node_modules|\.build)\//.test(file) && !file.includes('/node_modules/'));
  if (!files.includes('characters/shared.js')) files.push('characters/shared.js');
  inputs = new Set(files);
  if (polling) return;
  const groups = new Map<string, string[]>();
  for (const file of files) groups.set(file.split('/')[0], [...groups.get(file.split('/')[0]) || [], file]);
  for (const group of groups.values()) {
    const folder = folderOf(group);
    if (watchers.has(folder)) continue;
    const watcher = folder === path.posix.dirname(group[0]) && group.length === 1
      ? watch(path.join(root, group[0]), changed)
      : watch(path.join(root, folder), { recursive: true }, (_event, filename) => {
        if (filename && (inputs?.has(folder + '/' + filename.replaceAll('\\', '/')))) changed();
      });
    watchers.set(folder, watcher);
  }
}
const published = await readJson<GameManifest>(path.join(gameStore(root), 'manifest.json'));
if (published) learn(published);
let snapshot = '';
let pollingTimer: ReturnType<typeof setTimeout> | undefined;
async function poll(): Promise<void> {
  try {
    const values = await Promise.all([...inputs || []].sort().map(async name => {
      const info = await stat(path.join(root, name)).catch(() => undefined);
      return `${name}:${info?.mtimeMs}:${info?.size}`;
    }));
    const next = values.join('\n');
    if (snapshot && snapshot !== next) changed();
    snapshot = next;
  } catch (error) { console.error('Character source polling failed:', error); }
  if (!closed) pollingTimer = setTimeout(() => void poll(), lifecycleSavedFields.settings.builderPollMs.default);
}
if (polling) void poll();
function close(): void {
  closed = true;
  clearTimeout(timer);
  clearTimeout(pollingTimer);
  for (const watcher of watchers.values()) watcher.close();
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
changed();
console.log("Watching the class bundles' source files; only verified generations are published.");
