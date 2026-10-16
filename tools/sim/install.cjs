"use strict";
// Platform adapter for ChronAL 0.10.0's installer. The pinned checkout stays unmodified.
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const target = path.resolve(__dirname, "../../.build/sim/chronal");
// Upstream recreates runtime/app and runtime/.keep; validate owned, unredirected paths first.
for (const relative of ["runtime", "runtime/app", "runtime/.keep"]) {
  const directory = path.resolve(target, relative);
  if (!directory.startsWith(target + path.sep)) throw new Error("Installer path escaped simulator");
  if (
    fs.existsSync(directory) &&
    (fs.lstatSync(directory).isSymbolicLink() ||
      !fs.realpathSync(directory).startsWith(fs.realpathSync(target) + path.sep))
  )
    throw new Error(`Refusing redirected simulator install path: ${directory}`);
}
// Ignore ambient ChronAL paths so setup cannot touch another installation.
for (const key of Object.keys(process.env)) if (key.startsWith("CHRONAL_")) delete process.env[key];
const config = require(path.join(target, "lib/config.js"));
config.config = () => ({
  upstream: path.join(target, "upstream"),
  al_root: path.join(target, "runtime/app"),
});
if (process.platform === "win32") {
  const source = path.join(target, "upstream/adventureland_mongodb");
  const destination = path.join(target, "runtime/app");
  const excluded = new Set([
    ".git",
    "node_modules",
    "node/node_modules",
    "package-lock.json",
    "node/package-lock.json",
    "common",
    "secretsandconfig",
    "tauri",
    "images",
    "sounds",
  ]);
  const execSync = cp.execSync;
  cp.execSync = (command, options) => {
    if (command.startsWith("tar -C ") && options?.shell === "/bin/bash") {
      fs.cpSync(source, destination, {
        recursive: true,
        filter: (file) => !excluded.has(path.relative(source, file).split(path.sep).join("/")),
      });
      return Buffer.alloc(0);
    }
    return execSync(command, { ...options, windowsHide: true });
  };
  // The upstream installer only links directories, including the not-yet-created secrets directory.
  const symlinkSync = fs.symlinkSync;
  fs.symlinkSync = (from, to) => symlinkSync(from, to, "junction");
}
// Use the exact native E2E game revision while leaving ChronAL's checkout clean.
const pins = require("./pins.json"),
  upstreamFile = path.join(target, "upstream.json");
const readFileSync = fs.readFileSync;
fs.readFileSync = (file, options) => {
  const content = readFileSync(file, options);
  if (String(file) !== upstreamFile) return content;
  const upstream = JSON.parse(String(content));
  for (const key of ["game", "common", "config"]) upstream[key].commit = pins[key];
  const json = JSON.stringify(upstream);
  return typeof content === "string" ? json : Buffer.from(json);
};
console.log("installed:", require(path.join(target, "lib/install.js")).install());
