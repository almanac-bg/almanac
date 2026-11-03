import type { QuestionImage } from '@almanac/shared';
import { PixelRatio } from 'react-native';
import { API_URL } from './client';

/**
 * A question's picture, from its srcSet ("/qimg/a-512.webp 512w, /qimg/a-1024.webp 1024w"): for a box `width` points
 * wide, the smallest that is still sharp at the phone's density; with no width (the match, a picture the size of the
 * screen), the largest.
 */
export function pictureUri(image: Pick<QuestionImage, 'src' | 'srcSet'>, width?: number): string {
  const sizes = image.srcSet
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([path]) => !!path)
    .map(([path, w]) => ({ path: path!, w: Number.parseInt(w ?? '0', 10) || 0 }))
    .sort((a, b) => a.w - b.w);
  const need = width === undefined ? Number.POSITIVE_INFINITY : width * PixelRatio.get();
  const path = (sizes.find((s) => s.w >= need) ?? sizes.at(-1))?.path ?? image.src;
  return path.startsWith('http') ? path : `${API_URL}${path}`;
}
