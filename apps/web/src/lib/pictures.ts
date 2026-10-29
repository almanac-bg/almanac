import { SETS } from '@quiz/shared';

/**
 * A picture picked for a question, made fit to keep: at most SETS.imageSide on its longer side, drawn anew (which also
 * leaves behind a photo's metadata, such as where it was taken) and saved as WebP — or JPEG, where the browser can't
 * write WebP — within SETS.imageBytes. Null if it can't be read as a picture.
 */
export async function shrinkPicture(file: File): Promise<Blob | null> {
  const img = await load(file);
  if (!img) return null;
  for (let side: number = SETS.imageSide; side >= 400; side = Math.round(side * 0.8)) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    for (const quality of [0.85, 0.75, 0.65, 0.55]) {
      const webp = await encode(img, w, h, 'image/webp', quality);
      // A browser that can't write WebP hands back a PNG instead.
      const blob = webp?.type === 'image/webp' ? webp : await encode(img, w, h, 'image/jpeg', quality);
      if (blob && blob.size <= SETS.imageBytes) return blob;
    }
  }
  return null;
}

/** The file as an image, turned the way the camera held it (an <img> follows the photo's orientation). */
function load(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, w: number, h: number, type: string, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // JPEG has no transparency: what's see-through would turn black.
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
