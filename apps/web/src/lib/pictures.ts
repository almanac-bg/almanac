import { SETS } from '@quiz/shared';

/**
 * A picture picked for a question, made fit to keep: at most SETS.imageSide on its longer side, drawn anew (which also
 * leaves behind a photo's metadata, such as where it was taken) and saved as WebP — or JPEG, where the browser can't
 * write WebP — within SETS.imageBytes. Null if it can't be read as a picture.
 */
export async function shrinkPicture(file: File): Promise<Blob | null> {
  const img = await load(file);
  if (!img) return null;
  // One canvas for every try, drawn once a size and emptied after: iOS Safari frees canvases late and caps the memory
  // they take, and a new one each try (up to 32 of a 12 MP photo's size) could run it out mid-way.
  const canvas = document.createElement('canvas');
  try {
    let webp = true;
    for (let side: number = SETS.imageSide; side >= 400; side = Math.round(side * 0.8)) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      if (!draw(canvas, img, w, h, !webp)) return null;
      for (const quality of [0.85, 0.75, 0.65, 0.55]) {
        let blob = await toBlob(canvas, webp ? 'image/webp' : 'image/jpeg', quality);
        // A browser that can't write WebP hands back a PNG instead: JPEG from here on.
        if (webp && blob?.type !== 'image/webp') {
          webp = false;
          if (!draw(canvas, img, w, h, true)) return null;
          blob = await toBlob(canvas, 'image/jpeg', quality);
        }
        if (blob && blob.size <= SETS.imageBytes) return blob;
      }
    }
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** The picture at this size on the canvas (resizing clears it). `opaque`: on white, for JPEG, which has no transparency. */
function draw(canvas: HTMLCanvasElement, img: HTMLImageElement, w: number, h: number, opaque: boolean): boolean {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return true;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

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
