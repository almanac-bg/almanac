// A picture a host uploads for their own set, made anew on the server (the 31 October review, SEC-9 = MOD-6): what is
// kept and served is a WebP encoded here from the decoded pixels, never the bytes that came in, so nothing rides along
// in a file that a decoder would skip (bytes after the scan, a wrapper round other data). And a print of what it shows,
// so a picture a moderator blocked can't come back re-encoded, resized or a shade lighter.
import { SETS } from '@almanac/shared';
import sharp from 'sharp';

// libvips decodes in native code: only the two formats the editor sends are ever handed to a decoder. Every other
// loader it has (SVG, PDF, TIFF, HEIF, GIF, PNG…) is shut, whatever the bytes claim to be. Nothing is cached (each
// picture is made once), and one thread a picture leaves the rest of libuv's pool to the server.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadWebpBuffer'] });
sharp.cache(false);
sharp.concurrency(1);

/** A picture as kept: a still WebP of at most SETS.imageBytes (in all but a freak case), its size, and its print. */
export type Remade = { type: 'image/webp'; w: number; h: number; bytes: Buffer; print: string };

/**
 * The picture in `input` (a JPEG or a WebP, already checked by its structure: readPicture in sets.ts) made anew: the
 * pixels decoded, within SETS.imageSide² of them and 10 seconds, then encoded as WebP at the best of a few qualities
 * that fits SETS.imageBytes. Null when it can't be decoded as a picture.
 */
export async function remakePicture(input: Uint8Array): Promise<Remade | null> {
  const decoded = await sharp(input, { limitInputPixels: SETS.imageSide ** 2, failOn: 'error' })
    .timeout({ seconds: 10 })
    .raw()
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!decoded) return null;
  const { width, height, channels } = decoded.info;
  const pixels = () => sharp(decoded.data, { raw: { width, height, channels } });
  let bytes = Buffer.alloc(0);
  for (const quality of [82, 72, 62]) {
    bytes = await pixels().webp({ quality }).toBuffer();
    if (bytes.length <= SETS.imageBytes) break;
  }
  const grey = await pixels()
    .flatten({ background: '#fff' })
    .greyscale()
    .resize((PRINT.side + 1) * PRINT.cell, PRINT.side * PRINT.cell, { fit: 'fill' })
    .raw()
    .toBuffer();
  return { type: 'image/webp', w: width, h: height, bytes, print: printOf(grey) };
}

/**
 * A picture's print, a difference hash: the picture in grey on a grid of 17 × 16 cells, and for each cell beside the
 * next, whether it is the darker of the two (256 bits) — and whether by enough to count (`sure`: at least 3 levels of
 * 255), since a near tie flips with any re-encoding. Measured on the bank's 150 pictures (2 November 2026): a copy
 * re-encoded, resized to 60 % or 10 % lighter differs in at most 6 % of the sure bits; two different pictures in at
 * least 12 % (three planets on black, the closest), most in over 30 %. Cropping or mirroring isn't caught.
 */
export const PRINT = { side: 16, cell: 4, sure: 3, plain: 0.4, match: 0.09 } as const;

/** The print of a picture in grey at (side + 1)·cell × side·cell: 64 hex digits of bits, then 64 of which are sure. */
export function printOf(grey: Uint8Array): string {
  const { side, cell, sure } = PRINT;
  const across = side + 1;
  const sums = new Float64Array(across * side);
  for (let y = 0; y < side * cell; y++)
    for (let x = 0; x < across * cell; x++)
      sums[Math.floor(y / cell) * across + Math.floor(x / cell)] += grey[y * across * cell + x];
  const bits = Buffer.alloc((side * side) / 8);
  const sureBits = Buffer.alloc((side * side) / 8);
  for (let i = 0; i < side * side; i++) {
    const at = Math.floor(i / side) * across + (i % side);
    const [a, b] = [sums[at], sums[at + 1]];
    if (a < b) bits[i >> 3] |= 0x80 >> (i & 7);
    if (Math.abs(a - b) >= sure * cell * cell) sureBits[i >> 3] |= 0x80 >> (i & 7);
  }
  return bits.toString('hex') + sureBits.toString('hex');
}

/**
 * The picture printed `upload` shows what the blocked one printed `blocked` does: they differ in at most PRINT.match
 * of the bits the blocked one is sure of. Never for a plain blocked picture (fewer than PRINT.plain of its bits sure: a
 * flag, a diagram on white), whose print matches too much else — that one is matched only by its exact bytes.
 */
export function samePicture(blocked: string, upload: string): boolean {
  const half = PRINT.side ** 2 / 4;
  if (!/^[0-9a-f]+$/.test(blocked + upload) || blocked.length !== half * 2 || upload.length !== half * 2) return false;
  const bits = Buffer.from(blocked.slice(0, half), 'hex');
  const sure = Buffer.from(blocked.slice(half), 'hex');
  const theirs = Buffer.from(upload.slice(0, half), 'hex');
  let counted = 0;
  let differ = 0;
  for (let i = 0; i < sure.length; i++) {
    counted += ones(sure[i]);
    differ += ones((bits[i] ^ theirs[i]) & sure[i]);
  }
  return counted >= PRINT.plain * PRINT.side ** 2 && differ <= PRINT.match * counted;
}

const ones = (byte: number) => {
  let n = 0;
  for (let b = byte; b; b &= b - 1) n++;
  return n;
};
