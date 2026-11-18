// How wide a question's pictures are drawn, for the browser to pick each one's file by: each comes in three sizes
// (half, three quarters and the whole, bank/image.go), and a screen of two pixels to a point (an everyday phone's, a
// laptop's) takes the middle one, at about half the bytes, once it's told how wide the picture really is. A picture is picked as it's loaded ahead of its question (questions.ts: picturesIn) and again as
// it's drawn: the same width both times, so the same file.

import type { Picture } from "./types.ts";

/** A picture's shape: all its width is worked out from. */
type Shape = Pick<Picture, "w" | "h">;

/** The page's column (app.css, #app): at most 40rem with its sides, a 16px side each. */
const column = (width: number) => Math.min(width, 640) - 32;

/** The picture over a question (app.css, .picture): the column's width, and no taller than two fifths of the screen,
 * so that a tall picture on a phone is drawn narrower than the column. */
export function overSizes(p: Shape, width = innerWidth, height = innerHeight): string {
  return `${Math.round(Math.min(column(width), (0.4 * height * p.w) / p.h))}px`;
}

/** A choice's picture (app.css, .pic-option-img): half the column, less the gap between two and each option's sides,
 * in a box five by three that it fits inside, so that a tall one is drawn narrower. */
export function optionSizes(p: Shape, width = innerWidth): string {
  const box = (column(width) - 8) / 2 - 16;
  return `${Math.round(box * Math.min(1, (0.6 * p.w) / p.h))}px`;
}
