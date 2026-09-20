/** A CODE generation may read game state, but loses all effects on retirement. */
export class RetiredRunnerError extends Error {
  constructor() {
    super("CODE generation has been retired");
    this.name = "RetiredRunnerError";
  }
}

type Callable = (...args: unknown[]) => unknown;
type Host = Record<PropertyKey, unknown>;
type Subscription = {
  host: Host;
  event: unknown;
  listener: Callable;
  original: Callable;
  id: unknown;
};

export class RunnerScope {
  readonly abort = new AbortController();
  private readonly subscriptions: Subscription[] = [];
  private readonly timers = new Map<unknown, Callable>();
  private readonly facades = new WeakMap<object, object>();
  private readonly receivers = new WeakMap<object, object>();
  private retired = false;
  private readonly requests = new Set<{ abort(): void }>();

  guardFetch(fetcher: typeof fetch): typeof fetch {
    return (input, init) => {
      this.assertActive();
      const signal = init?.signal || (input instanceof Request ? input.signal : null);
      return fetcher(input, {
        ...init,
        signal: AbortSignal.any([this.abort.signal, ...(signal ? [signal] : [])]),
      });
    };
  }

  guardAjax(jquery: unknown): void {
    if (!jquery || (typeof jquery !== "object" && typeof jquery !== "function")) return;
    const host = jquery as { ajax?: (...args: unknown[]) => unknown };
    const ajax = host.ajax;
    if (!ajax) return;
    host.ajax = (...args) => {
      this.assertActive();
      const request = Reflect.apply(ajax, jquery, args) as {
        abort(): void;
        always(callback: () => void): void;
      };
      this.requests.add(request);
      request.always(() => this.requests.delete(request));
      return request;
    };
  }

  assertActive(): void {
    if (this.retired) throw new RetiredRunnerError();
  }

  private invoke(host: Host, key: PropertyKey, args: unknown[]): unknown {
    this.assertActive();
    return Reflect.apply(host[key] as Callable, host, args);
  }

  private ordinaryMethod(host: Host, key: PropertyKey): Callable {
    const invoke = (receiver: unknown, args: unknown[]) => {
      this.assertActive();
      return Reflect.apply(host[key] as Callable,
        receiver == null ? host : this.unwrapReceiver(receiver), args);
    };
    return function (this: unknown, ...args: unknown[]) { return invoke(this, args); };
  }

  private unwrapReceiver(receiver: unknown): unknown {
    if (typeof receiver === "object" && receiver !== null)
      return this.receivers.get(receiver) ?? receiver;
    return receiver;
  }

  private subscribe(host: Host, key: PropertyKey, args: unknown[]): unknown {
    const [event, listener, ...rest] = args;
    if (typeof listener !== "function") return this.invoke(host, key, args);
    const guarded = (...values: unknown[]) => {
      if (!this.retired) return Reflect.apply(listener, host, values);
    };
    const result = this.invoke(host, key, [event, guarded, ...rest]);
    this.subscriptions.push({
      host,
      event,
      listener: guarded,
      original: listener as Callable,
      id: result,
    });
    return result === host ? this.facade(host) : result;
  }

  private timer(host: Host, key: string, args: unknown[]): unknown {
    const [callback, delay, ...rest] = args;
    if (typeof callback !== "function") throw new TypeError("CODE timers require a function");
    const guarded = (...values: unknown[]) => {
      if (key === "setTimeout") this.timers.delete(id);
      if (!this.retired) return Reflect.apply(callback, host, values);
    };
    const id = this.invoke(host, key, [guarded, delay, ...rest]);
    this.timers.set(id, () =>
      this.invokeCleanup(host, key === "setTimeout" ? "clearTimeout" : "clearInterval", [id]),
    );
    return id;
  }

  private invokeCleanup(host: Host, key: PropertyKey, args: unknown[]): void {
    if (typeof host[key] === "function") Reflect.apply(host[key] as Callable, host, args);
  }

  private method(host: Host, key: PropertyKey): Callable {
    if (key === "remove")
      return (...args) => {
        this.assertActive();
        const index = this.subscriptions.findLastIndex(
          (entry) => entry.host === host && entry.id === args[0],
        );
        if (index >= 0) this.subscriptions.splice(index, 1);
        return this.invoke(host, key, args);
      };
    if (key === "off" || key === "removeListener")
      return (...args) => {
        this.assertActive();
        const index = this.subscriptions.findLastIndex(
          (entry) => entry.host === host && entry.event === args[0] && entry.original === args[1],
        );
        if (index < 0) return this.invoke(host, key, args);
        const [entry] = this.subscriptions.splice(index, 1);
        return this.invoke(host, key, [entry.event, entry.listener]);
      };
    if (key === "on" || key === "once" || key === "addListener")
      return (...args) => {
        this.assertActive();
        return this.subscribe(host, key, args);
      };
    if (key === "setTimeout" || key === "setInterval")
      return (...args) => this.timer(host, key, args);
    return this.ordinaryMethod(host, key);
  }

  /** Only effect-bearing roots need proxies; large, frequently read G/entities stay shared. */
  facade<T extends object>(target: T): T {
    const cached = this.facades.get(target);
    if (cached) return cached as T;
    const host = target as Host;
    // An empty target avoids violating non-configurable Window property invariants.
    const facade = new Proxy(Object.create(null) as T, {
      get: (_target, key) => {
        const value = Reflect.get(host, key, host);
        if (value === target) return facade;
        if (typeof value === "function") return this.method(host, key);
        if (
          value &&
          typeof value === "object" &&
          ["socket", "character", "caracAL", "parent", "top", "window"].includes(String(key))
        )
          return this.facade(value);
        return value;
      },
      set: (_target, key, value) => {
        this.assertActive();
        return Reflect.set(host, key, value, host);
      },
      has: (_target, key) => key in host,
      ownKeys: () => Reflect.ownKeys(host),
      getOwnPropertyDescriptor: (_target, key) =>
        key in host
          ? {
              configurable: true,
              enumerable: true,
              writable: true,
              value: Reflect.get(host, key, host),
            }
          : undefined,
    });
    this.facades.set(target, facade);
    this.receivers.set(facade, target);
    return facade;
  }

  dispose(): void {
    if (this.retired) return;
    this.retired = true;
    this.abort.abort();
    for (const request of this.requests) request.abort();
    this.requests.clear();
    for (const clear of this.timers.values()) clear();
    this.timers.clear();
    for (const { host, event, listener, id } of this.subscriptions) {
      if (typeof host.off === "function" || typeof host.removeListener === "function")
        this.invokeCleanup(host, typeof host.off === "function" ? "off" : "removeListener", [
          event,
          listener,
        ]);
      else this.invokeCleanup(host, "remove", [id]);
    }
    this.subscriptions.length = 0;
  }
}
