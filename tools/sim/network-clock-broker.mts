import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import type {Socket} from 'node:net';
import {performance as nativePerformance} from 'node:perf_hooks';

// A caller can already use an observation/virtual Date. Broker pacing and
// real-I/O budgets must remain on an independent, monotonic native timeline.
const wallNow=()=>Math.floor(nativePerformance.timeOrigin+nativePerformance.now());
type ClockSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", callback: (bytes: Buffer) => void): void;
  on(event: "close", callback: () => void): void;
  on(event: "error", callback: () => void): void;
};
function clockRequest(raw: string | undefined) {
  const url = new URL(raw || "/", "http://localhost");
  return { url, id: url.searchParams.get("id"), scope: url.searchParams.get("scope") || "" };
}
/** One bounded gameplay timeline; real network/storage callbacks run between acknowledgements. */
export async function startNetworkClock(rate: number) {
  if (!Number.isFinite(rate) || rate <= 1 || rate > 1024) throw Error("ChronAL clock rate must be greater than 1 and at most 1024; use E2E_GAMEPLAY_BACKEND=native for real time");
  const windowMs=Number(process.env.E2E_CLOCK_WINDOW_MS||250);
  if(!Number.isInteger(windowMs)||windowMs<25||windowMs>250)throw Error('ChronAL network window must be 25–250 ms');
  const epoch = wallNow(),
    token = randomUUID(),
    members = new Map<string, { now: number; scope: string; label: string; sent: number; count: number; total: number; max: number; nativeIo?:boolean; timing?: {count:number;receiveMs:number;workMs:number;returnMs:number} }>();
  const retired = new Set<string>();
  let now = epoch,
    closed = false,
    lastWall = epoch,
    budget = 0,nativeIoActive=false,nativeIoSince=0,nativeIoWallMs=0;
  function reconcileNativeIo(){
    const active=[...members.values()].some(member=>member.nativeIo),wall=wallNow();
    if(active===nativeIoActive)return;
    if(nativeIoActive)nativeIoWallMs+=wall-nativeIoSince;
    nativeIoActive=active;nativeIoSince=active?wall:0;
    // Discard credit from the previous mode; no post-I/O catch-up burst.
    budget=0;lastWall=wall;
  }
  const sockets = new Map<string, ClockSocket>();
  const connections=new Set<Socket>();
  const server = createServer((req, res) => {
    const { url, id, scope } = clockRequest(req.url);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    if (url.searchParams.get("token") !== token) {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname === "/leave" && id) {
      members.delete(id);
      retired.add(id);
      sockets.get(id)?.close();
    } else if (url.pathname === "/scope") {
      for (const [key, value] of members)
        if (value.scope === scope) {
          members.delete(key);
          retired.add(key);
          sockets.get(key)?.close();
        }
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        now,
        rate,
        effectiveRate:nativeIoActive?1:rate,
        windowMs,
        epoch,
        members: members.size,
        ...(url.pathname === "/diagnostics"
          ? {
              wallMs: wallNow() - epoch,
              virtualMs: now - epoch,
              nativeIoWallMs:nativeIoWallMs+(nativeIoActive?wallNow()-nativeIoSince:0),
              participants: [...members].map(([id, value]) => ({
                id,
                ...value,
                lag: now - value.now,
              })),
            }
          : {}),
      }),
    );
  });
  server.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  const require = createRequire(import.meta.url);
  const { WebSocketServer } = require(
    require.resolve("ws", {
      paths: [path.resolve(".build/sim/chronal"), path.resolve(".caracal")],
    }),
  );
  const ws = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost"),
      id = url.searchParams.get("id");
    if (closed || url.searchParams.get("token") !== token || !id || retired.has(id)) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (connection: ClockSocket) => {
      sockets.set(id, connection);
      members.set(id, { now, scope: url.searchParams.get("scope") || "", label: url.searchParams.get("label") || id, sent: wallNow(), count: 0, total: 0, max: 0 });
      connection.on("message", (bytes: Buffer) => {
        let value: { now?: number; kind?:string; active?:boolean; receivedWall?:number; completedWall?:number; workMs?:number };
        try {
          value = JSON.parse(bytes.toString());
        } catch {
          connection.close(1008, "Invalid clock acknowledgement");
          return;
        }
        if(value?.kind==='native-io'){
          if(typeof value.active!=='boolean'){connection.close(1008,'Invalid native I/O observation');return;}
          if(sockets.get(id)===connection&&members.has(id)){members.get(id)!.nativeIo=value.active;reconcileNativeIo();}
          return;
        }
        if (typeof value?.now!=='number' || !Number.isFinite(value.now) || value.now > now) {
          connection.close(1008, "Invalid clock acknowledgement");
          return;
        }
        if (sockets.get(id) === connection && members.has(id)) {
          const member = members.get(id)!;
          const elapsed = wallNow() - member.sent;
          member.now = value.now;
          member.count++;
          member.total += elapsed;
          member.max = Math.max(member.max, elapsed);
          if([value.receivedWall,value.completedWall,value.workMs].every(Number.isFinite)){
            const timing=member.timing??={count:0,receiveMs:0,workMs:0,returnMs:0};
            timing.count++;timing.receiveMs+=value.receivedWall!-member.sent;
            timing.workMs+=value.workMs!;timing.returnMs+=wallNow()-value.completedWall!;
          }
        }
      });
      connection.on("close", () => {
        if (sockets.get(id) === connection) {
          sockets.delete(id);
          members.delete(id);
        }
      });
      connection.on("error", () => connection.close());
      connection.send(JSON.stringify({ now, rate, epoch }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("ChronAL clock broker did not bind");
  const timer = setInterval(() => {
    reconcileNativeIo();
    const wall = wallNow();
    // Real XHR is not accelerated. Preserve its original timeout budget while
    // it is in flight; ordinary gameplay timers resume the requested rate.
    budget = Math.min(windowMs, budget + Math.max(0, wall - lastWall) * (nativeIoActive?1:rate));
    lastWall = wall;
    if (
      closed ||
      budget < windowMs ||
      !members.size ||
      [...members.values()].some((member) => member.now < now)
    )
      return;
    // Keep sockets responsive and avoid charging gameplay time for slow asset,
    // browser or database work. No participant may run ahead of another.
    // Discard blocked wall-time credit: removing a slow participant must never
    // produce a catch-up burst that consumes real persistence/shutdown budgets.
    now += windowMs;
    budget -= windowMs;
    for (const member of members.values()) member.sent = wall;
    for (const socket of sockets.values())
      if (socket.readyState === 1) socket.send(JSON.stringify({ now, rate, epoch }));
  }, 2);
  return {
    port: address.port,
    token,
    epoch,
    close: async () => {
      closed = true;
      clearInterval(timer);
      await new Promise<void>((resolve) => {
        server.close(()=>resolve());
        for (const socket of sockets.values()) socket.terminate();
        ws.close();
        // Includes incomplete upgrades, which closeAllConnections excludes.
        for(const socket of connections)socket.destroy();
      });
    },
  };
}
