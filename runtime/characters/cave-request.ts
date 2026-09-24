// Cave interaction wire protocol is not included in typed-adventureland.
// Keep one socket and request identity through settlement, including in Steam CODE.
interface Reply {
  request_id?: string;
  place?: string;
  failed?: boolean;
  reason?: string;
  visit?: unknown;
}
interface Socket {
  connected?: boolean;
  prependAny?(listener: (event: string, data: Reply) => void): unknown;
  offAny?(listener: (event: string, data: Reply) => void): unknown;
  on(event: string, listener: (data: Reply) => void): unknown;
  off(event: string, listener: (data: Reply) => void): unknown;
  emit(event: string, fields: Record<string, unknown>): unknown;
}
export function requestCave(
  socket: Socket,
  id: string,
  action: string,
  fields: Record<string, unknown> = {},
  timers = {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    if (!socket || socket.connected === false) return reject(Error("Cave socket disconnected"));
    let settled = false;
    const timer = timers.setTimeout(() => finish({ failed: true, reason: "timeout" }), action === "enter" ? 150000 : 10000);
    function finish(data: Reply) {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      socket.off("game_response", response);
      socket.offAny?.(incoming);
      socket.off("disconnect", disconnected);
      if (data.failed) reject(data);
      else resolve(data);
    }
    function response(data: Reply) {
      if (data?.request_id === id && data.place === "interaction") finish(data);
    }
    function disconnected() { finish({ failed: true, reason: "disconnected" }); }
    function incoming(event: string, data: Reply) {
      if (event === "game_response") response(data);
    }
    // Native UI handlers can prevent later event listeners from seeing a reply.
    // Capture our correlated reply first without replacing or suppressing those handlers.
    if (socket.prependAny && socket.offAny) socket.prependAny(incoming);
    else socket.on("game_response", response);
    socket.on("disconnect", disconnected);
    try { socket.emit("interaction", { ...fields, type: "cave", action, request_id: id }); }
    catch (error) {
      finish({ failed: true, reason: error instanceof Error ? error.message : String(error) });
    }
  });
}
Object.assign(globalThis, { requestCave });
