// Adapted from thmsndk/caracAL 30ead440 (MIT): discover official client dependencies.
const fs = require('node:fs/promises'), path = require('node:path'), vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const { JSDOM } = require('../.caracal/node_modules/jsdom');
const site = 'https://adventure.land';
const head = ['/js/phrases.js','/phrases/en.js','/js/pixi/fake/pixi.min.js','/js/libraries/combined.js','/js/codemirror/fake/codemirror.js'];
const fallback = { game: [...head,'/js/common_functions.js','/js/old_common_functions.js','/js/functions.js','/js/game.js','/js/html.js','/js/merrit_stand_notice.js','/js/payments.js','/js/keyboard.js','/data.js'],
 runner: ['/js/common_functions.js','/js/old_common_functions.js','/js/runner_functions.js','/js/runner_compat.js'] };
function scripts(html, runner = false) {
 const dom = new JSDOM(html), files = runner ? [] : [...head];
 try {
  for (const element of dom.window.document.querySelectorAll('script[src]')) {
   const url = new URL(element.getAttribute('src'), site);
   if (url.origin !== site) continue;
   let file = url.pathname;
   if (file.startsWith('/js/pixi/')) file = '/js/pixi/fake/pixi.min.js';
   else if (file.startsWith('/js/codemirror/')) file = '/js/codemirror/fake/codemirror.js';
   else if (!/^\/js\/(?:progression\/)?[^/]+\.js$/.test(file) && file !== '/data.js') continue;
   if (file === '/js/ios-drag-drop.js') continue;
   files.push(file);
  }
 } finally { dom.window.close(); }
 const result = [...new Set(files)];
 const required = runner ? ['/js/runner_functions.js','/js/runner_compat.js'] : ['/js/game.js','/data.js'];
 if (!required.every(file => result.includes(file))) throw new Error('Official page is missing required client scripts');
 return result;
}
function locate_game_file(resource, version) {
 if (!/^\d+$/.test(String(version))) throw new Error('Invalid game version');
 return path.join('game_files', String(version), path.posix.basename(resource));
}
function manifest(version) {
 if (!version) return fallback;
 try {
  const value = JSON.parse(readFileSync(path.join('game_files', String(version), 'client_scripts.json'), 'utf8'));
  if (!['game','runner'].every(kind => Array.isArray(value[kind]) && value[kind].length && value[kind].every(file => /^\/(js\/|phrases\/|data\.js$)/.test(file) && !file.includes('..')))) throw Error('Invalid client manifest');
  return value;
 } catch (error) { if (error.code !== 'ENOENT') throw error; return fallback; }
}
async function available_versions() {
 await fs.mkdir('game_files', { recursive: true });
 return (await fs.readdir('game_files', { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).map(entry => Number(entry.name)).sort((a,b) => b-a);
}
async function text(url) { const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!response.ok) throw Error(`Client download failed: HTTP ${response.status}`); return response.text(); }
let pending;
async function refresh(force = false, validateData = false) {
 const html = await text(site), version = /game\.js\?v=(\d+)/.exec(html)?.[1];
 if (!version) throw Error('Official page has no game version');
 const runnerHtml = await text(site + '/runner');
 const next = { game: scripts(html), runner: scripts(runnerHtml, true) };
 const files = [...new Set([...next.game,...next.runner])];
 if (new Set(files.map(file => path.posix.basename(file))).size !== files.length) throw Error('Client script filenames collide');
 const directory = path.join('game_files', version), stage = path.join('game_files', '.stage-' + randomUUID());
 await fs.mkdir(stage, { recursive: true });
 try {
  for (const resource of files) {
   const name = path.posix.basename(resource);
   let source;
   try { if (force) throw Error('Refresh requested'); source = await fs.readFile(path.join(directory, name), 'utf8'); new vm.Script(source); }
   catch { source = await text(site + resource + '?v=' + version); }
   if (!source.trim()) throw Error('Empty client script: ' + resource);
   new vm.Script(source, { filename: resource });
   await fs.writeFile(path.join(stage, name), source);
  }
  if (validateData) {
   const sandbox = {};
   vm.runInNewContext(await fs.readFile(path.join(stage, 'data.js'), 'utf8'), sandbox, {timeout: 5000});
   if (!sandbox.G?.geometry || !sandbox.G?.items || !sandbox.G?.maps) throw Error('Incomplete candidate game data');
  }
  await fs.writeFile(path.join(stage, 'client_scripts.json'), JSON.stringify(next));
  try { await fs.access(directory); }
  catch (error) {
   if (error.code !== 'ENOENT') throw error;
   // Publish a new version as one directory rename, never a partial numeric cache.
   await fs.rename(stage, directory); return Number(version);
  }
  // Existing complete files remain available until every new dependency is validated.
  for (const resource of files) await fs.rename(path.join(stage, path.posix.basename(resource)), locate_game_file(resource, version));
  await fs.rename(path.join(stage, 'client_scripts.json'), path.join(directory, 'client_scripts.json'));
  return Number(version);
 } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
async function get_revision(version) {
 const value = manifest(version), hash = createHash('sha256').update(JSON.stringify(value));
 for (const file of [...new Set([...value.game, ...value.runner])]) hash.update(file).update(await fs.readFile(locate_game_file(file, version)));
 return hash.digest('hex');
}
// Live updates must surface failure, never silently activate a fallback version.
async function refresh_latest(force = false) {
 if (!pending) pending = refresh(force, true).finally(() => { pending = null; });
 const version = await pending;
 return {version, revision: await get_revision(version)};
}
function ensure_latest() {
 if (!pending) pending = refresh(true, true).catch(async error => {
  for (const version of await available_versions()) {
   try { const value = manifest(version); for (const file of new Set([...value.game,...value.runner])) new vm.Script(await fs.readFile(locate_game_file(file, version), 'utf8')); console.warn('Client update failed; retaining complete cached version:', error.message); return version; }
   catch { /* Try the next complete cached version. */ }
  }
  throw error;
 }).finally(() => { pending = null; });
 return pending;
}
async function cull_versions(exclusions = []) {
 for (const version of (await available_versions()).slice(2)) if (!exclusions.includes(version)) await fs.rm(path.join('game_files', String(version)), { recursive: true });
}
module.exports = { scripts, refresh_latest, get_revision, ensure_latest, available_versions, cull_versions, locate_game_file,
 get_game_files: version => manifest(version).game, get_runner_files: version => manifest(version).runner };
