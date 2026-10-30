// caracAL evaluates CODE in a jsdom 24 window, whose AbortSignal has only
// abort() and timeout(). Browsers and Node have AbortSignal.any, but Node's
// rejects a jsdom signal, which reaches the runner's guarded fetch from CODE.
type SignalHost = typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal };

/** One signal that aborts with the reason of the first input that aborts. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const host = AbortSignal as SignalHost;
  if (typeof host.any === "function" && signals.every((signal) => signal instanceof AbortSignal))
    return host.any(signals);
  if (signals.length === 1) return signals[0];
  const controller = new AbortController();
  const listeners: [AbortSignal, () => void][] = [];
  const settle = (source: AbortSignal) => {
    // The first abort removes every listener, so the long-lived loader and
    // lifecycle signals do not keep one closure per finished request.
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.length = 0;
    controller.abort(source.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      settle(signal);
      break;
    }
    const listener = () => settle(signal);
    listeners.push([signal, listener]);
    signal.addEventListener("abort", listener, { once: true });
  }
  return controller.signal;
}
