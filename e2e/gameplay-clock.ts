import { expect } from "./network-clock";
import type { LiveGame } from "./live-fixtures";
import type { LiveClient } from "./live-game-client";

/** Gameplay observations only; browser, transport faults and persistence stay on LiveGame. */
export type GameplayWorld = Pick<LiveGame, "state" | "post" | "admin"> & {
  clients: Record<string, Pick<LiveClient, "run" | "events" | "snapshot">>;
  now?: () => number;
  advance?: (milliseconds: number) => Promise<void>;
};
type Options = { timeout?: number; intervals?: number[]; message?: string };
export const gameplayNow = (world: GameplayWorld) => (world.now ? world.now() : Date.now());

/** Same predicate/assertions on both backends, bounded by gameplay time and a wall watchdog. */
export function poll<T>(world: GameplayWorld, observe: () => Promise<T>, options: Options = {}) {
  if (!world.advance) return expect.poll(observe, options);
  async function until(assert: (value: T) => void) {
    const timeout = options.timeout ?? 15000,
      deadline = gameplayNow(world) + timeout;
    const wallDeadline = Date.now() + timeout + 30000;
    const intervals = options.intervals ?? [100, 250, 500, 1000];
    let attempt = 0,
      failure: unknown;
    for (;;) {
      try {
        assert(await observe());
        return;
      } catch (error) {
        failure = error;
      }
      const remaining = deadline - gameplayNow(world);
      if (remaining <= 0 || Date.now() >= wallDeadline)
        throw new Error(`${options.message || "Gameplay poll expired"}: ${String(failure)}`);
      const step = Math.min(remaining, intervals[Math.min(attempt++, intervals.length - 1)]);
      if (world.advance) await world.advance(step);
      else await new Promise((resolve) => setTimeout(resolve, step));
    }
  }
  return {
    toBe: (value: unknown) => until((actual) => expect(actual).toBe(value)),
    toEqual: (value: unknown) => until((actual) => expect(actual as unknown).toEqual(value)),
    toBeGreaterThan: (value: number) =>
      until((actual) => {
        expect(typeof actual).toBe("number");
        expect(Number(actual)).toBeGreaterThan(value);
      }),
  };
}
