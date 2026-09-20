import type { HttpRequest, HttpResponse } from "../http/contracts.ts";
import type { CharacterBlock } from "../characters/types.ts";

/** Express surface consumed by the coordinator and its middleware. */
export type WebMiddleware = (
  request: HttpRequest & { method?: string },
  response: HttpResponse,
  next: () => void,
) => unknown;
export interface WebRouter {
  get(path: string, handler: WebMiddleware): unknown;
  post(path: string, ...handlers: WebMiddleware[]): unknown;
  use(middleware: WebMiddleware): unknown;
  use(path: string, middleware: WebMiddleware): unknown;
}
export interface WebApplication extends WebRouter {
  listen(port: number, host?: string): unknown;
}
export interface ExpressPlatform {
  (): WebApplication;
  static(path: string): WebMiddleware;
  json(options: { limit: string }): WebMiddleware;
  text(options: { type: string; limit: string }): WebMiddleware;
}

export interface MonitorInterface {
  destroy(): void;
  setDataSource(source: () => Record<string, unknown>): void;
}
export interface MonitorPublisher {
  createInterface(
    structure: { name: string; type: string; label?: string; options?: unknown }[],
  ): MonitorInterface;
}
/** BWI exposes an Express router; its HTTP listener belongs to the BWI instance. */
export interface WebMonitor {
  router: WebRouter;
  publisher: MonitorPublisher;
}
export interface MonitorConstructor {
  new (options: { port: number; password: null; updateRate: number }): WebMonitor;
}
export interface MonitoringPlatform {
  create_monitor_ui(
    monitor: Pick<WebMonitor, "publisher">,
    name: string,
    block: CharacterBlock,
    minimap?: boolean,
  ): MonitorInterface;
}
