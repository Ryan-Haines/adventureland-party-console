import { proxyGameImage } from '@/lib/game-image';

export function GET(request: Request) {
  return proxyGameImage(request, '/images/', /\.(png|gif|webp|jpe?g)$/i, 'Map image');
}
