export async function GET(request: Request) {
  const url = new URL(new URL(request.url).searchParams.get('url') || '/', 'https://adventure.land');
  if (url.origin !== 'https://adventure.land' || !url.pathname.startsWith('/images/tiles/monsters/') || !url.pathname.endsWith('.png'))
    return new Response('Invalid monster sprite', { status: 400 });
  const response = await fetch(url, { redirect: 'manual' });
  if (!response.ok) return new Response('Sprite unavailable', { status: 502 });
  return new Response(response.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
}
