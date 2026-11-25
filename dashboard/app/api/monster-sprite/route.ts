import { proxyGameImage } from '@/lib/game-image';

export function GET(request: Request) {
  return proxyGameImage(request, '/images/tiles/monsters/', /\.png$/, 'Monster sprite');
}
