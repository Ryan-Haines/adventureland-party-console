import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { gateway } from '../hosting/gateway.ts';
import { Access } from '../hosting/access.ts';
import { body, json } from '../hosting/http.ts';
import { gameViewer } from './viewer.ts';
const loginPage = `<!doctype html><html><title>Debug instance</title><body style="background:#020617;color:white;font:16px sans-serif;padding:2rem"><p id="message">Opening debug console…</p><script>
const token=new URLSearchParams(location.hash.slice(1)).get('debug');history.replaceState(null,'','/');
fetch('/debug-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(r=>{if(!r.ok)throw Error();location.reload();}).catch(()=>document.getElementById('message').textContent='Open this instance using the link in your main console.');
</script></body></html>`;
/** `ports` are the instance's dashboard and coordinator ports, which instance.mts starts its children on. */
export function debugGateway(access: Access, token: string, ready: () => Promise<boolean>, ports: { dashboardPort: number; apiPort: number }) {
  const cookieName = 'debug_' + token.slice(0, 12);
  const authorized = (cookie = '') => cookie.split(';').some(value => value.trim() === cookieName + '=' + token);
  const inner = gateway({ access, configured: () => true, ...ports });
  const viewer = gameViewer(access);
  async function login(req: IncomingMessage, res: ServerResponse) {
    try {
      if (new URL(req.headers.origin || '').host !== req.headers.host) throw Error('Same-origin login required');
      const input = await body(req), supplied = typeof input.token === 'string' ? input.token : '';
      if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) throw Error('Invalid debug link');
      res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      json(res, 200, { ok: true });
    } catch { json(res, 403, { error: 'Open this instance using the link in your main console.' }); }
  }
  function admission(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (authorized(req.headers.cookie)) return true;
    if (pathname !== '/' || req.method !== 'GET') json(res, 401, { error: 'Debug instance authentication required' });
    else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(loginPage); }
    return false;
  }
  function debugInfo(res: ServerResponse, pathname: string) {
    if (pathname === '/console-debug') json(res, 200, { insideDebug: true, phase: 'running' });
    else if (pathname.startsWith('/console-debug/')) json(res, 403, { error: 'Use your main console to manage this instance.' });
    else if (pathname === '/console-update') json(res, 200, { managed: false, phase: 'idle', current: 'debug', displayVersion: 'Debug instance' });
    else return false;
    return true;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url || '/', 'http://internal');
    if (url.pathname === '/health') { const answer = await ready(); json(res, answer ? 200 : 503, { ready: answer }); return; }
    if (url.pathname === '/debug-login' && req.method === 'POST') { await login(req, res); return; }
    if (!admission(req, res, url.pathname)) return;
    if (viewer.request(req, res)) return;
    if (debugInfo(res, url.pathname)) return;
    inner.emit('request', req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!authorized(req.headers.cookie)) { socket.destroy(); return; }
    if (viewer.matches(req.url)) { viewer.strip(req); viewer.server.emit('upgrade', req, socket, head); }
    else inner.emit('upgrade', req, socket, head);
  });
  return server;
}
