import { codeResponseHeaders } from "./middleware.ts";

interface WebSettings {
  port: number;
  enable_bwi?: boolean;
  enable_minimap?: boolean;
  expose_CODE?: boolean;
  party_dashboard?: boolean;
  expose_TYPECODE?: boolean;
}
interface Router<Middleware> {
  use: (path: string, middleware: Middleware | typeof codeResponseHeaders) => unknown;
}
interface WebPorts<
  Middleware,
  Server extends Router<Middleware>,
  Monitor extends { router?: Server },
> {
  createRouter: () => Server & { listen: (port: number, host?: string) => unknown };
  createMonitor: (options: { port: number; password: null; updateRate: number }) => Monitor;
  retainMonitor: (monitor: Monitor) => void;
  staticFiles: (path: string) => Middleware;
  dashboard: (router: Server) => void;
  info: (details: { type: string; src_path?: string }, message: string) => void;
  error: (message: string, error?: unknown) => void;
  directory: string;
  updateRate: number;
}

function serveCode<
  Middleware,
  Server extends Router<Middleware>,
  Monitor extends { router?: Server },
>(
  server: Server | undefined,
  settings: WebSettings,
  ports: WebPorts<Middleware, Server, Monitor>,
): Server {
  if (!server) {
    const app = ports.createRouter();
    server = app;
    app.listen(settings.port, "127.0.0.1");
  }
  const directory = ports.directory + "/../CODE";
  ports.info({ type: "CODE_exposed", src_path: directory }, "Serving CODE statically");
  server.use("/CODE", codeResponseHeaders);
  server.use("/CODE", ports.staticFiles(directory));
  return server;
}

function serveTypeCode<
  Middleware,
  Server extends Router<Middleware>,
  Monitor extends { router?: Server },
>(
  server: Server | undefined,
  settings: WebSettings,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  if (!server) {
    const app = ports.createRouter();
    server = app;
    app.listen(settings.port);
  }
  const directory = ports.directory + "/../TYPECODE.out";
  ports.info({ type: "TYPECODE_exposed", src_path: directory }, "Serving TYPECODE statically");
  server.use("/TYPECODE", ports.staticFiles(directory));
}

/** Reuse the monitor router and preserve legacy binding, setup order and partial-start failure behavior. */
export function startCoordinatorWebServices<
  Middleware,
  Server extends Router<Middleware>,
  Monitor extends { router?: Server },
>(
  settings: WebSettings | undefined,
  typeCodeEnabled: boolean,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  try {
    if (settings) startConfiguredServices(settings, typeCodeEnabled, ports);
  } catch (error) {
    ports.error("failed to start web services.", error);
    ports.error("no web services will be available");
  }
}

function startConfiguredServices<
  Middleware,
  Server extends Router<Middleware>,
  Monitor extends { router?: Server },
>(
  settings: WebSettings,
  typeCodeEnabled: boolean,
  ports: WebPorts<Middleware, Server, Monitor>,
): void {
  let server: Server | undefined;
  if (settings.enable_bwi || settings.enable_minimap) {
    const monitor = ports.createMonitor({
      port: settings.port,
      password: null,
      updateRate: ports.updateRate,
    });
    ports.retainMonitor(monitor);
    server = monitor.router;
  }
  if (settings.expose_CODE || settings.party_dashboard) server = serveCode(server, settings, ports);
  if (settings.party_dashboard) {
    // Dashboard implies CODE above, which supplies the router before any routes are installed.
    ports.dashboard(server!);
    ports.info(
      { type: "party_dashboard" },
      "Party API listening on http://127.0.0.1:" + settings.port,
    );
  }
  if (settings.expose_TYPECODE && typeCodeEnabled) serveTypeCode(server, settings, ports);
}
