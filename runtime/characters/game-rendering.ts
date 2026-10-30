// Native renderer descriptors are Pixi animation state, not game entity reports.
// Keep this boundary local; these fields are absent from typed-adventureland.
interface Sprite {
  skin: string; stype: string; frames?: number; cskin?: string;
}
// Native skill-bar and progress tints (functions.js add_tint). Tint lists only
// the fields tint_logic reads outside its DOM calls.
interface Tint { type?: string; end?: Date; i?: number; mid?: Date; on_end?(): void }
export interface GameRenderHost {
  textures: Record<string, unknown>;
  set_texture(this: void, sprite: Sprite, i: number, j?: number): void;
  console?: Pick<Console, 'warn'>;
  __partyTextureGuard?: GameRenderHost['set_texture'];
  no_graphics?: unknown;
  tints?: Tint[];
  tint_logic?(this: void): void;
  delete_indices?(this: void, list: unknown[], indices: number[]): void;
  __partyHeadlessTints?: () => void;
}
const sheets = new Set(['full', 'wings', 'body', 'armor', 'skin', 'tail', 'character', 'upper']);
const directional = new Set(['v_animation', 'head', 'hair', 'hat', 's_wings', 'face', 'makeup', 'beard']);
const animated = new Set(['animation', 'animatable']);
const layered = new Set(['a_makeup', 'a_hat']);
function at(value: unknown, index: number | undefined): unknown {
  return Array.isArray(value) && index !== undefined ? value[index] : undefined;
}
function frame(game: GameRenderHost, sprite: Sprite, i: number, j?: number): unknown {
  const texture = game.textures[(sprite.stype === 'upper' ? 'upper' : '') + sprite.skin];
  if (sheets.has(sprite.stype)) return at(at(texture, i), j);
  if (animated.has(sprite.stype)) return at(texture, i % Number(sprite.frames));
  if (sprite.stype === 'emote') return at(texture, i % 3);
  const row = at(texture, i % Number(sprite.frames));
  if (layered.has(sprite.stype)) return at(row, Number(j) % (at(texture, 0) as unknown[])?.length);
  return Array.isArray(row) ? at(row, (j || 0) % row.length) : row;
}
function supported(sprite: Sprite): boolean {
  return sheets.has(sprite.stype) || directional.has(sprite.stype) || animated.has(sprite.stype) ||
    layered.has(sprite.stype) || sprite.stype === 'emote';
}

const ending = new Set(['skill', 'progress', 'dissipate', 'brute', 'fill']);
/** One headless tint_logic frame for one tint; true when the tint ended. */
function tintFrame(tint: Tint, start: Date): boolean {
  const over = ending.has(String(tint.type)) && tint.end !== undefined && start > tint.end;
  if (over && tint.type === 'fill') {
    tint.type = 'glow';
    tint.on_end?.();
  }
  if (tint.type === 'dissipate') {
    if (!over && tint.i === 19) tint.mid = new Date();
    tint.i = Number(tint.i) + 1;
  }
  return over;
}
/**
 * The game's 16 ms draw loop calls tint_logic, which restyles the skill bar
 * and progress tints with jQuery on every frame: 2.1 s of the 9.5 s draw loop
 * in a headless priest's 150 s farming profile (docs/efficiency.md, CT6). A
 * headless client has no renderer and no viewer of that DOM, so headlessTints
 * keeps only tint_logic's list work: it drops ended tints, turns an ended fill
 * into glow before its on_end callback, and advances the dissipate counter.
 */
function headlessTints(game: GameRenderHost): void {
  if (!game.no_graphics || typeof game.tint_logic !== 'function' || typeof game.delete_indices !== 'function' ||
      game.tint_logic === game.__partyHeadlessTints) return;
  const remove = game.delete_indices;
  const logic = () => {
    const tints = game.tints;
    if (!Array.isArray(tints)) return;
    const start = new Date(), ended: number[] = [];
    for (let index = 0; index < tints.length; index++) if (tintFrame(tints[index], start)) ended.push(index);
    remove(tints, ended);
  };
  game.tint_logic = game.__partyHeadlessTints = logic;
}

/** An unavailable cosmetic frame must not terminate native draw/physics scheduling. */
export function installGameRendering(game: GameRenderHost): void {
  headlessTints(game);
  if (typeof game.set_texture !== 'function' || game.set_texture === game.__partyTextureGuard) return;
  const original = game.set_texture, reported = new Set<string>();
  const guarded: GameRenderHost['set_texture'] = function(sprite, i, j) {
    if (supported(sprite) && sprite.cskin !== String(i) + String(j) && frame(game, sprite, i, j) == null) {
      const key = JSON.stringify([sprite.skin, sprite.stype, i, j]);
      if (!reported.has(key)) {
        if (reported.size >= 64) reported.delete(reported.values().next().value!);
        reported.add(key);
        game.console?.warn('Native sprite frame unavailable; retaining previous texture', {skin:sprite.skin, stype:sprite.stype, i, j});
      }
      // Do not set cskin: a later draw must retry a newly available texture.
      return;
    }
    original(sprite, i, j);
  };
  game.set_texture = game.__partyTextureGuard = guarded;
}
