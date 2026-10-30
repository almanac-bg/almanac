import clsx from 'clsx';

/**
 * The game's art: Microsoft's Fluent Emoji 3D (MIT licence, src/emoji/LICENSE), one picture per emoji, named by its
 * code points. The same on every device, where a system emoji is Apple's on one phone, Google's on the next and
 * Microsoft's flat one on a laptop — and an earned avatar is more than a glyph anyone can type.
 */
const ART = import.meta.glob('../emoji/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;
/** The same at 64 px, for where it's drawn small (most of the time: beside text). A third of the bytes. */
const SMALL = import.meta.glob('../emoji/64/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>;
const byCode = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), url]));
const BY_CODE = byCode(ART);
const SMALL_BY_CODE = byCode(SMALL);

const codeOf = (emoji: string) =>
  [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== 'fe0f')
    .join('-');

/** The picture for an emoji, if the art set has it. */
export const emojiArt = (emoji: string): string | null => BY_CODE.get(codeOf(emoji)) ?? null;

/**
 * An emoji as the game draws it: its picture from the art set, else the system's glyph. As big as the text around it
 * unless `size` says otherwise. Decorative unless it has a `label` (then it's an image with that name).
 */
export function Emoji({
  e,
  size,
  label,
  className,
}: {
  e: string | undefined;
  /** A CSS length, or px. */
  size?: number | string;
  label?: string;
  className?: string;
}) {
  // A lookup that found none (a medal past third place): nothing to draw.
  if (!e) return null;
  const src = emojiArt(e);
  const named = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (!src)
    return (
      <span {...named} className={className}>
        {e}
      </span>
    );
  const side = size ?? '1.15em';
  const small = SMALL_BY_CODE.get(codeOf(e));
  return (
    <img
      src={small ?? src}
      // The browser takes the 64 px one where it's enough (the size it's drawn at, times the screen's density), the
      // 192 px one for the big art. `auto`: the size it's laid out at (a lazy image's right); a browser that doesn't
      // know it takes the next — a size in px or rem as given, but for one in em (of text whose size this can't
      // know: `sizes` counts em from 16 px) the full picture, never a blurred one.
      srcSet={small ? `${small} 64w, ${src} 192w` : undefined}
      sizes={
        small
          ? `auto, ${typeof side === 'number' ? `${side}px` : /(?:px|rem)$/.test(side) ? side : '100vw'}`
          : undefined
      }
      loading="lazy"
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      draggable={false}
      decoding="async"
      className={clsx('inline-block shrink-0 align-[-0.2em] select-none', className)}
      style={{ width: side, height: side }}
    />
  );
}
