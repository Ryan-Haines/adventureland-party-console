// The supervisor's mode change and its upstream proxy (tools/dashboard/supervisor.mts), over ports, so
// a test drives the code the supervisor runs.
import { request, type IncomingMessage, type ServerResponse } from "node:http";

export type Mode = "development" | "production";

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

// One operation at a time: claim() refuses while one runs, and the routes answer that refusal 409.
export class Busy extends Error {}

export interface ModePorts<Candidate> {
  /** The running server's mode, or undefined before the first one is healthy. */
  activeMode(): Mode | undefined;
  /** A development switch back to the retained development server, true when it ran. */
  restoreDevelopment(mode: Mode): Promise<boolean>;
  /** A new server for the mode and the selected release, or undefined when that release already runs. */
  createCandidate(mode: Mode, selected?: string): Promise<Candidate | undefined>;
  activate(candidate: Candidate): Promise<void>;
  /** Stops the failed candidate and records the error as the supervisor's failure. */
  rejectCandidate(candidate: Candidate | undefined, error: unknown): Promise<void>;
  saveMode(mode: Mode): Promise<void>;
  pin(): Promise<void>;
}

// The supervisor's change state: whether an operation runs, the last failure and the pinned rollback
// release, which saveMode writes to the mode file.
export function createModeChange<Candidate>(ports: ModePorts<Candidate>) {
  const state = { busy: false, failure: null as string | null, rollbackSelection: undefined as string | undefined };
  function claim(): void {
    if (state.busy) throw new Busy("A dashboard operation is in progress");
    state.busy = true;
  }
  // The claim is taken before the first await, so a route knows at once whether its change runs.
  function changeMode(mode: Mode, selected?: string): Promise<void> {
    claim();
    return switchMode(mode, selected).finally(() => { state.busy = false; });
  }
  // A failed switch puts the earlier rollback selection back, so the pin and the mode file keep it.
  async function switchMode(mode: Mode, selected?: string): Promise<void> {
    if (ports.activeMode() === mode && mode === "development") return;
    state.failure = null;
    let candidate: Candidate | undefined;
    const priorSelection = state.rollbackSelection;
    try {
      state.rollbackSelection = selected;
      if (await ports.restoreDevelopment(mode)) return;
      candidate = await ports.createCandidate(mode, selected);
      if (candidate) await ports.activate(candidate);
      else { await ports.saveMode(mode); await ports.pin(); }
    } catch (error) {
      state.rollbackSelection = priorSelection;
      await ports.rejectCandidate(candidate, error);
      throw error;
    }
  }
  return { state, claim, changeMode };
}

// The proxy to a dashboard server on `port`. A missing script, style or font asset falls back once to
// the previous server, which keeps serving tabs opened before a switch.
export function createProxy(ports: { previousPort(): number | undefined }) {
  return function proxy(req: IncomingMessage, res: ServerResponse, port: number, fallback = true): void {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${port}` },
      },
      (response) => {
        const previous = ports.previousPort();
        if (
          response.statusCode === 404 &&
          fallback &&
          previous !== undefined &&
          req.method === "GET" &&
          /\.(js|css|woff2?)(\?|$)/.test(req.url || "")
        ) {
          response.resume();
          proxy(req, res, previous, false);
          return;
        }
        res.writeHead(response.statusCode || 502, response.headers);
        res.flushHeaders();
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) json(res, 502, { error: "Dashboard temporarily unavailable" });
      else res.end();
    });
    res.on("close", () => upstream.destroy());
    if (fallback) req.pipe(upstream);
    else upstream.end();
  };
}
