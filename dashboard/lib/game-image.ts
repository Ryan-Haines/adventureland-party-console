// The one proxy for the game's images, which the map and the monster sprites load through the
// console so a canvas can read their pixels. It fetches only an image under `prefix` on
// adventure.land.
//
// It answers from a copy it keeps of each image, so no browser request waits on adventure.land
// (REVIEW-QUEUE TW-D1). Over plain HTTP the browser opens six connections to the console, and in
// final-gate-closing12 sprite loads stalled on the game's site held all six while the Hunt start
// and a blacklist add queued behind them. The first request for an image starts the copy's one
// fetch and answers 503 at once; the sprite draws unshifted and the map leaves that tileset out
// until the dashboard asks again. A copy is kept by its URL as the game data names it: the game
// marks a changed image with a new `?v=` (data.js `"/images/sprites/animations/pinky.png?v=2"`), so
// a game version that changes an image asks a new URL, and that URL gets its own fetch. A failed
// fetch keeps no copy, and the next request for that image fetches again. The browser caches each
// copy as the game server's Cache-Control says.
type Copy = { body: ArrayBuffer; type: string; cache: string | null };
const copies = new Map<string, Copy | Promise<void>>();

function fetchCopy(source: URL) {
  const key = source.href;
  copies.set(key, (async () => {
    try {
      const response = await fetch(source, { redirect: 'manual' });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      copies.set(key, { body: await response.arrayBuffer(), type: response.headers.get('content-type') || 'image/png', cache: response.headers.get('cache-control') });
    } catch {
      copies.delete(key);
    }
  })());
}

export async function proxyGameImage(request: Request, prefix: string, extension: RegExp, what: string): Promise<Response> {
  const source = new URL(new URL(request.url).searchParams.get('url') || '/', 'https://adventure.land');
  if (source.origin !== 'https://adventure.land' || !source.pathname.startsWith(prefix) || !extension.test(source.pathname))
    return new Response(`Invalid ${what.toLowerCase()}`, { status: 400 });
  const copy = copies.get(source.href);
  if (!copy) fetchCopy(source);
  if (!copy || copy instanceof Promise)
    return new Response(`${what} loading`, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const headers = new Headers({ 'Content-Type': copy.type, 'X-Content-Type-Options': 'nosniff' });
  if (copy.cache) headers.set('Cache-Control', copy.cache);
  return new Response(copy.body, { headers });
}
