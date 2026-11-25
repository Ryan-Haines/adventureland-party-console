// The play window runner (test-windows DESIGN.md section 3). A window is one gameplay scenario:
// the play runs once and every check of the window is an observer of it. This file holds the
// runner's order and outcomes and imports nothing from Playwright or the game, so its self-test
// (e2e/window-runner.test.mts) runs with no stack. e2e/windows.ts binds it to the live fixture.

// An observer reads the play and never drives it: `start` installs its read before the play,
// `sample` runs on the window's shared poll, `verdict` asserts at the end. `reads` hands the dump
// the values it compared and the bounds it used, so a failure is traced from its first run.
export type Observer<W> = {
  id: string; owner: string; behaviours: string[];
  start(world: W): unknown; sample?(world: W, tick: number): unknown; verdict(world: W): unknown;
  reads?(): unknown;
};
// One line of the reset proof that disagrees with the fixture's declared start.
export type ProofLine = { line: string; expected: unknown; actual: unknown };
export type WindowRun<W> = {
  id: string;
  proof(world: W): Promise<ProofLine[]>;
  play(world: W): Promise<void>;
  observers: Observer<W>[];
  // The shared poll's period, when an observer samples. A window names the cadence its observers
  // read (a report period, a call window), so the runner holds none of its own.
  pollMs?: number;
  dump(world: W): Promise<unknown>;
  undo(world: W): Promise<void>;
  // The global undo: `record` runs before the reset proof and `restore` after the window's own
  // undo, so that undo still finds the globals it saved its state in.
  globals?: { record(world: W): Promise<void>; restore(world: W): Promise<unknown> };
};
export type Verdict = { id: string; owner: string; status: 'passed' | 'failed' | 'not observed'; error?: string };
export type WindowResult = { outcome: 'passed' | 'failed' | 'play failed' | 'dirty start'; verdicts: Verdict[]; error?: Error };
export type WindowSteps = { step(title: string, fn: () => Promise<void>): Promise<void>; attach(name: string, body: unknown): Promise<void> };

const message = (error: unknown) => String((error as Error)?.message ?? error);

export async function runWindow<W>(world: W, run: WindowRun<W>, steps: WindowSteps): Promise<WindowResult> {
  const verdicts = new Map<string, Verdict>(run.observers.map(o => [o.id, { id: o.id, owner: o.owner, status: 'not observed' }]));
  const fail = (id: string, error: unknown) => { const v = verdicts.get(id)!; if (v.status !== 'failed') Object.assign(v, { status: 'failed', error: message(error) }); };
  let outcome: WindowResult['outcome'] = 'passed', error: Error | undefined;
  try {
    // A mismatch fails the window before any play, so no check reads another window's world.
    let dirty: ProofLine[] = [];
    if (run.globals) await steps.step(`${run.id} global record`, () => run.globals!.record(world));
    await steps.step(`${run.id} reset proof`, async () => { dirty = await run.proof(world); });
    if (dirty.length) {
      outcome = 'dirty start';
      error = Error(`${run.id} dirty start: ` + dirty.map(d => `${d.line} expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`).join('; '));
      return finish();
    }
    const started = new Set<string>();
    for (const o of run.observers) {
      try { await o.start(world); started.add(o.id); } catch (e) { fail(o.id, `start failed: ${message(e)}`); }
    }
    // The shared poll: each observer's sample in turn, a failed one recorded on its own observer.
    let playing = true, tick = 0;
    const sampled = run.observers.filter(o => o.sample && started.has(o.id));
    const poll = (async () => {
      if (!sampled.length) return;
      if (!run.pollMs) throw Error(`${run.id} has sampling observers and names no poll period`);
      while (playing) {
        for (const o of sampled) if (verdicts.get(o.id)!.status !== 'failed') { try { await o.sample!(world, tick); } catch (e) { fail(o.id, e); } }
        tick++;
        await new Promise(resolve => setTimeout(resolve, run.pollMs));
      }
    })();
    try { await steps.step(`${run.id} play`, () => run.play(world)); }
    catch (e) {
      playing = false; await poll.catch(() => {});
      outcome = 'play failed'; error = Error(`${run.id} play failed: ${message(e)}`);
      // Nothing was observed: the verdicts stay "not observed", never "passed".
      for (const v of verdicts.values()) Object.assign(v, { status: 'not observed', error: message(e) });
      return finish();
    }
    playing = false;
    await poll;
    for (const o of run.observers) {
      const v = verdicts.get(o.id)!;
      if (v.status === 'failed') { await steps.step(o.id, async () => { throw Error(v.error); }).catch(() => {}); continue; }
      try { await steps.step(o.id, async () => { await o.verdict(world); }); v.status = 'passed'; }
      catch (e) { fail(o.id, e); }
    }
    const failed = [...verdicts.values()].filter(v => v.status === 'failed');
    if (failed.length) { outcome = 'failed'; error = Error(`${run.id} checks failed: ` + failed.map(v => `${v.id}: ${v.error}`).join(' | ')); }
    return finish();
  } catch (e) {
    outcome = 'failed'; error = e as Error;
    return finish();
  }
  // Every end, pass or fail: the dump first, while the world still holds the play, then the undo.
  async function finish(): Promise<WindowResult> {
    const result: WindowResult = { outcome, verdicts: [...verdicts.values()], error };
    let dump: unknown;
    try { dump = await run.dump(world); } catch (e) { dump = { error: message(e) }; }
    const reads = Object.fromEntries(run.observers.map(o => { try { return [o.id, o.reads?.() ?? null]; } catch (e) { return [o.id, { error: message(e) }]; } }));
    await steps.attach(`${run.id}-window-state`, { outcome, verdicts: result.verdicts, state: dump, observers: reads });
    const failUndo = (what: string, e: unknown) => { result.outcome = result.outcome === 'passed' ? 'failed' : result.outcome; result.error ??= Error(`${run.id} ${what} failed: ${message(e)}`); };
    try { await run.undo(world); } catch (e) { failUndo('undo', e); }
    if (run.globals) {
      try { await steps.attach(`${run.id}-global-undo`, await run.globals.restore(world)); } catch (e) { failUndo('global undo', e); }
    }
    return result;
  }
}

// The global undo inside one realm (a page, its game frame, the game server). A window leaves two
// kinds of global behind: a new __e2e name (a saved original, a ledger, a timer) and a game
// function it wrapped (broadcast_e behind announceSpawn, new_monster behind a spawner). The scope
// hands the realm's own reads: the game server's functions are bindings of node/server.js's module
// scope, so only an eval there reads or writes them, and its __e2e names sit on globalThis.
export type GlobalScope = {
  names(): string[];
  functionNames(): string[];
  get(name: string): unknown;
  set(name: string, value: unknown): void;
  remove(name: string): boolean;
  // A timer held in a deleted name keeps firing, so the scope stops it first.
  stop(value: unknown): void;
};
export type GlobalRecord = { names: string[]; functions: Map<string, unknown> };
export type GlobalUndo = { added: string[]; replaced: string[]; stuck: string[] };

// windows.ts ships these two functions into each realm as their source text, so the self-test
// runs the same code on a plain object. Each one reads only its arguments.
export function recordGlobals(scope: GlobalScope): GlobalRecord {
  const functions = new Map<string, unknown>();
  for (const name of scope.functionNames()) { const value = scope.get(name); if (typeof value === 'function') functions.set(name, value); }
  return { names: scope.names().filter(name => name.startsWith('__e2e')), functions };
}
// The game data undo. A window also edits the game's shared data in place (a catalog monster made
// peaceful, a Cave encounter list cut down), and every monster the server makes after that copies
// the edit (node/server.js new_monster). The record keeps each object of a table with its own keys
// and values, so the restore puts back the same objects, by reference, with their own values, and
// a live monster that holds one keeps holding it. `only` limits a root to the named tables, and
// `play` names the keys the game itself writes in play below the root, which the undo leaves alone.
export type DataNode = { ref: Record<string, unknown>; only: boolean; play: string[]; keys: [string, unknown, DataNode | null][] };
export function recordData(value: Record<string, unknown>, only?: string[], play: string[] = []): DataNode {
  const node = (v: unknown) => v && typeof v === 'object' ? recordData(v as Record<string, unknown>, undefined, play) : null;
  const keys = only ?? Object.keys(value).filter(k => !play.includes(k));
  return { ref: value, only: !!only, play, keys: keys.map(k => [k, value[k], node(value[k])] as [string, unknown, DataNode | null]) };
}
// Returns the path of every key that differs from the record. With `write` it also puts each one
// back, a swapped object by its recorded reference. The reset proof runs it with `write` false and
// compares by value only: the fixture's reset swaps some definitions for equal copies before every
// window (e2e/game/bootstrap.cjs, the Horseman baseline).
export function restoreData(node: DataNode, path: string, write: boolean, changed: string[] = [], value = node.ref): string[] {
  const kept = new Set(node.keys.map(([k]) => k));
  if (!node.only) for (const k of Object.keys(value)) if (!kept.has(k) && !node.play.includes(k)) { changed.push(`${path}.${k}`); if (write) delete value[k]; }
  if (write && Array.isArray(value)) value.length = node.keys.length;
  for (const [k, v, child] of node.keys) {
    const now = value[k];
    if (child && !write && now && typeof now === 'object') { restoreData(child, `${path}.${k}`, write, changed, now as Record<string, unknown>); continue; }
    if (now !== v) { changed.push(`${path}.${k}`); if (write) value[k] = v; }
    if (child && write) restoreData(child, `${path}.${k}`, write, changed);
  }
  return changed;
}

// `keep` names the harness's and the fixture's own globals, which their owners install and remove.
export function restoreGlobals(scope: GlobalScope, record: GlobalRecord, keep: string[]): GlobalUndo {
  const undo: GlobalUndo = { added: [], replaced: [], stuck: [] };
  for (const name of scope.names()) {
    if (!name.startsWith('__e2e') || record.names.includes(name) || keep.includes(name)) continue;
    scope.stop(scope.get(name));
    (scope.remove(name) ? undo.added : undo.stuck).push(name);
  }
  for (const [name, value] of record.functions) {
    if (keep.includes(name) || scope.get(name) === value) continue;
    scope.set(name, value); undo.replaced.push(name);
  }
  return undo;
}
