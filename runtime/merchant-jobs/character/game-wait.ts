// The merchant job owner's wait on the game. It ends when the game's own packets show the state the
// caller waits for: each named socket event re-reads `done()`, and so does the time `due()` names,
// a cooldown's end in the client's `next_skill`. The caller's bound ends the wait unmet when the game
// never sends the change, so each bound is a kept one that its caller reports.
import type { Emitter, ScopeHandle } from '../../lifecycle/api.ts';

export type WaitScope = Pick<ScopeHandle, 'on' | 'off' | 'setTimeout' | 'clearTimeout'>;

// The character's own update (`player`) carries its position, `moving`, `c` channels, `s` conditions,
// MP and bag; the client's `eval` packet runs the server's `skill_timeout`, which moves `next_skill`.
export const OWN_UPDATE = ['player', 'eval'] as const;
// Another entity's update: `entities` carries its position and slots, `disappear` its leaving.
export const ENTITY_UPDATE = ['entities', 'disappear', 'player'] as const;

/** Resolves true once `done()` holds, read now, on each of `events` and at the time `due()` names,
 *  and resolves with `done()` once `bound` ms pass. A run's stop drops the listeners and timers. */
export function untilGame(scope: WaitScope, events: readonly string[], done: () => boolean, bound: number, due?: () => number): Promise<boolean> {
  const socket = (globalThis as { parent?: { socket?: Emitter } }).parent?.socket ?? null;
  return new Promise<boolean>(resolve => {
    let open = true, wake: number | undefined;
    const finish = (met: boolean) => {
      if (!open) return;
      open = false;
      for (const event of events) scope.off(socket, event, check);
      scope.clearTimeout(wake);
      scope.clearTimeout(limit);
      resolve(met);
    };
    function check(): void {
      if (!open) return;
      if (done()) { finish(true); return; }
      scope.clearTimeout(wake);
      wake = undefined;
      const at = due ? due() : 0;
      if (at > Date.now()) wake = scope.setTimeout(check, at - Date.now());
    }
    for (const event of events) scope.on(socket, event, check);
    const limit = scope.setTimeout(() => finish(done()), bound);
    check();
  });
}
