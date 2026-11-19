import { inspectorPort } from './platform.ts';
import { bounded, type HostBound } from '../hosting/http.ts';

export interface InspectorTarget { url: string; socket: string }
// No inspector answers: no game window runs with automation. LocalSteam reads this as no window open;
// every other inspector error (a refused socket host, a malformed or oversized list) reaches its caller.
export class InspectorUnavailable extends Error {}
const origin = `http://127.0.0.1:${inspectorPort}`;
// The desktop inspector's bounds against a game client process that accepts and never answers: the
// target list, the socket open and one command's reply. Each logs when it ends its wait.
const TARGET_LIST: HostBound = { name: 'inspectorTargetsMs', ms: 2000 };
const SOCKET_OPEN: HostBound = { name: 'inspectorOpenMs', ms: 4000 };
const COMMAND_REPLY: HostBound = { name: 'inspectorCommandMs', ms: 6000 };
const fired = (bound: HostBound) => console.warn(`[bound] ${bound.name} (${bound.ms} ms) ended a desktop inspector wait`);
export function gameUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' &&
    ['adventure.land', 'www.adventure.land', 'cloudflare.adventure.land'].includes(url.hostname) && !url.port; }
  catch { return false; }
}
export function windowsTargets(value: unknown): InspectorTarget[] {
  if (!Array.isArray(value)) throw Error('Invalid desktop inspector response.');
  return value.filter(entry => entry.type === 'page' && gameUrl(entry.url)).map(entry => {
    const url = new URL(entry.webSocketDebuggerUrl);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== String(inspectorPort))
      throw Error('Desktop inspector must stay on this computer.');
    return { url: entry.url, socket: url.href };
  });
}
/** WebKitGTK's HTTP inspector lists targets in table rows, with /socket/{connection}/{target}/WebPage. */
export function linuxTargets(html: string): InspectorTarget[] {
  const result: InspectorTarget[] = [];
  for (const row of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const url = /class="targeturl">([^<]+)</.exec(row[1])?.[1].replaceAll('&amp;', '&');
    const socket = /\/socket\/\d+\/\d+\/WebPage/.exec(row[1])?.[0];
    if (url && socket && gameUrl(url)) result.push({ url, socket: origin.replace('http:', 'ws:') + socket });
  }
  return result;
}
export async function targets(platform = process.platform): Promise<InspectorTarget[]> {
  const response = await bounded(TARGET_LIST, 'the desktop target list', signal => fetch(origin + (platform === 'win32' ? '/json/list' : '/'), { signal, redirect: 'error' }))
    .catch((error: Error) => { throw new InspectorUnavailable('Desktop inspector is not available: ' + error.message); });
  if (!response.ok) throw new InspectorUnavailable('Desktop inspector is not available.');
  const text = await response.text();
  if (text.length > 1024 * 1024) throw Error('Desktop inspector response is too large.');
  return platform === 'win32' ? windowsTargets(JSON.parse(text)) : linuxTargets(text);
}
interface Reply { id?: number; result?: { result?: { value?: unknown }; targetId?: string; [key: string]: unknown }; error?: { message: string }; method?: string; params?: { targetInfo?: { targetId: string }; message?: string } }
export class Inspector {
  private socket: WebSocket;
  private sequence = 0;
  private targetId?: string;
  private pending = new Map<number, { resolve(value: Reply['result']): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', event => {
      try { this.receive(JSON.parse(String(event.data))); }
      catch { this.close(); }
    });
    socket.addEventListener('close', () => this.rejectAll());
    socket.addEventListener('error', () => this.rejectAll());
  }
  static async connect(target: InspectorTarget) {
    const socket = new WebSocket(target.socket);
    const inspector = new Inspector(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { fired(SOCKET_OPEN); socket.close(); reject(Error('Desktop inspector connection timed out.')); }, SOCKET_OPEN.ms);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Cannot attach to desktop inspector.')); }, { once: true });
    });
    return inspector;
  }
  private receive(reply: Reply) {
    if (reply.method === 'Target.targetCreated') this.targetId = reply.params?.targetInfo?.targetId;
    if (reply.method === 'Target.dispatchMessageFromTarget' && reply.params?.message) this.receive(JSON.parse(reply.params.message));
    const pending = reply.id === undefined ? undefined : this.pending.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(reply.id!);
    if (reply.error) pending.reject(Error(reply.error.message)); else pending.resolve(reply.result);
  }
  private request(method: string, params: object, nested: boolean): Promise<Reply['result']> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { fired(COMMAND_REPLY); this.pending.delete(id); reject(Error('Desktop command timed out.')); }, COMMAND_REPLY.ms);
      this.pending.set(id, { resolve, reject, timer });
      const message = JSON.stringify({ id, method, params });
      if (nested && this.targetId) void this.request('Target.sendMessageToTarget', { targetId: this.targetId, message }, false).catch(error => {
        clearTimeout(timer); this.pending.delete(id); reject(error);
      });
      else {
        try { this.socket.send(message); }
        catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      }
    });
  }
  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.request('Runtime.evaluate', { expression, returnByValue: true }, true);
    if (reply?.exceptionDetails || reply?.wasThrown) throw Error('Adventure Land could not run the desktop bridge.');
    return reply?.result?.value;
  }
  private rejectAll() {
    for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(Error('Desktop inspector disconnected.')); }
    this.pending.clear();
  }
  close() { this.rejectAll(); this.socket.close(); }
}
