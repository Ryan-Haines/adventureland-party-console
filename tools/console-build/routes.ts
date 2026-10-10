import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConsoleBuildController, DeploymentConflict } from './controller.ts';
async function deploymentId(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) throw new Error('Request too large'); }
  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== 'object' || !('buildId' in input) || typeof input.buildId !== 'string') throw new Error('Provide a completed candidate ID');
  return input.buildId;
}

/** The hosting gateway authorizes these routes before forwarding any request. */
export function consoleBuildRoutes(controller: ConsoleBuildController) {
  return {async route(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify(value));
    };
    try {
      if (['/console-build', '/console-build/status'].includes(pathname) && req.method === 'GET') { json(200, await controller.status()); return; }
      if (!['/console-build', '/console-build/deploy'].includes(pathname)) { json(404, {error: 'Unknown console build route'}); return; }
      if (req.method !== 'POST') { json(405, {error: 'Use POST'}); return; }
      json(202, await controller.deploy(await deploymentId(req)));
    } catch (error) { json(error instanceof DeploymentConflict ? 409 : 400, {error: error instanceof Error ? error.message : String(error)}); }
  }};
}
