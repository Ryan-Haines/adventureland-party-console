// The one proxy for the game's images, which the map and the monster sprites load through the
// console so a canvas can read their pixels. It fetches only an image under `prefix` on
// adventure.land, and the fetch lives as long as the browser's request: the browser drops a request
// it no longer waits for, and that aborts the fetch, so a stalled game server holds nothing. The
// browser caches each image as the game server's own Cache-Control says.
export async function proxyGameImage(request: Request, prefix: string, extension: RegExp, what: string): Promise<Response> {
  const source = new URL(new URL(request.url).searchParams.get('url') || '/', 'https://adventure.land');
  if (source.origin !== 'https://adventure.land' || !source.pathname.startsWith(prefix) || !extension.test(source.pathname))
    return new Response(`Invalid ${what.toLowerCase()}`, { status: 400 });
  try {
    const response = await fetch(source, { redirect: 'manual', signal: request.signal });
    if (!response.ok) return new Response(`${what} unavailable`, { status: 502 });
    const headers = new Headers({ 'Content-Type': response.headers.get('content-type') || 'image/png', 'X-Content-Type-Options': 'nosniff' });
    const cache = response.headers.get('cache-control');
    if (cache) headers.set('Cache-Control', cache);
    return new Response(response.body, { headers });
  } catch {
    return new Response(`${what} unavailable`, { status: 502 });
  }
}
