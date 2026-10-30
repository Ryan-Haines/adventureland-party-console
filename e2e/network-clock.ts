import { expect as nativeExpect } from "@playwright/test";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
const require = createRequire(import.meta.url);
export const clockRate = () => Number(process.env.E2E_CLOCK_RATE || 1);
/** Native browser/CDP network timing has a wall epoch, independent of gameplay. */
export const nativeWallNow = () => performance.timeOrigin + performance.now();
/** CI may advance below native speed; a stall means no virtual progress. */
function clockStalled() {
  let observed=Date.now(),progressAt=performance.now();
  return () => {
    const current=Date.now(),wall=performance.now();
    if(current>observed){observed=current;progressAt=wall;}
    return wall-progressAt>=30000;
  };
}
export function gameplayTimers(): Pick<typeof globalThis, 'setTimeout'|'clearTimeout'|'setInterval'|'clearInterval'> | undefined {
  return require("../tools/sim/network-clock.cjs").install({ dateOnly: true }).timers;
}
/** Preserve an existing gameplay observation window on either backend. */
export async function waitForGameplay(milliseconds: number) {
  if (clockRate() === 1) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  const deadline = Date.now() + milliseconds, stalled=clockStalled();
  while (Date.now() < deadline) {
    if (stalled())
      throw Error("ChronAL gameplay clock stalled during observation window");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(50, (deadline - Date.now()) / clockRate())),
    );
  }
}
export const expect: typeof nativeExpect = new Proxy(nativeExpect, {
  get(target, key, receiver) {
    if (key === "poll")
      return (
        callback: () => unknown,
        options: { timeout?: number; intervals?: number[]; message?: string } = {},
      ) => {
        const rate = clockRate();
        if (rate === 1) return target.poll(callback, options);
        type PollResult = ReturnType<typeof nativeExpect.poll>;
        const matcher = (negative = false): PollResult =>
          new Proxy({} as PollResult, {
            get(_object, name) {
              if (name === "not") return matcher(!negative);
              if (name === "then") return undefined;
              return async (...args: unknown[]) => {
                const timeout = options.timeout ?? 15000,
                  deadline = Date.now() + timeout, stalled=clockStalled();
                const intervals = options.intervals ?? [100, 250, 500, 1000];
                let attempt = 0,
                  failure: unknown;
                for (;;) {
                  try {
                    const observed = await callback(),
                      assertion = negative ? nativeExpect(observed).not : nativeExpect(observed);
                    const execute = Reflect.get(assertion, name);
                    if (typeof execute !== "function")
                      throw Error("Unsupported gameplay poll matcher: " + String(name));
                    await Reflect.apply(execute, assertion, args);
                    return;
                  } catch (error) {
                    failure = error;
                  }
                  const stopped=stalled();
                  if (Date.now() >= deadline || stopped)
                    throw new Error(
                      `${options.message || "ChronAL gameplay poll expired"}${stopped?` (shared clock stalled at ${Date.now()}, virtual deadline ${deadline})`:''}: ${String(failure)}`,
                    );
                  await new Promise((resolve) =>
                    setTimeout(
                      resolve,
                      intervals[Math.min(attempt++, intervals.length - 1)] / rate,
                    ),
                  );
                }
              };
            },
          });
        return matcher();
      };
    return Reflect.get(target, key, receiver);
  },
});
export async function installObservationClock() {
  const clock = require("../tools/sim/network-clock.cjs").install({ dateOnly: true });
  await clock.ready;
  return clock;
}
