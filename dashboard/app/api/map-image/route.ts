export async function GET(request: Request) {
  const source = new URL(new URL(request.url).searchParams.get('url') || '/', 'https://adventure.land');
  if (source.origin !== 'https://adventure.land' || !source.pathname.startsWith('/images/') ||
      !/\.(png|gif|webp|jpe?g)$/i.test(source.pathname))
    return new Response('Invalid map image', {status:400});
  try {
    const response = await fetch(source, {redirect:'manual',signal:AbortSignal.timeout(15_000)});
    if (!response.ok) return new Response('Map image unavailable', {status:502});
    return new Response(response.body, {headers:{
      'Content-Type':response.headers.get('content-type') || 'image/png',
      'Cache-Control':'public, max-age=86400',
      'X-Content-Type-Options':'nosniff',
    }});
  } catch { return new Response('Map image unavailable', {status:502}); }
}
