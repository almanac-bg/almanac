import type { ImageCredit, QuestionImage } from '@almanac/shared';
import clsx from 'clsx';
import { m } from 'motion/react';
import { useState } from 'react';
import { PICTURE_SIZES } from './pictureSizes';

const LICENSES: Record<string, string> = { PD: 'обществено достояние' };

// Said once: some credits are Commons itself.
const fromCommons = (c: ImageCredit) =>
  !!c.sourceUrl?.startsWith('https://commons.wikimedia.org/') && !/wikimedia/i.test(c.credit);

/**
 * A question's picture: as large as it fits, at most `maxHeight` of the screen (40% in a match, so the question and its
 * options still fit on a phone; a parent may set `--pic-h` instead, to cap it by the room left), its box kept while it
 * loads so nothing below it jumps. Whose it is shows once the answer is out (`credit`): a painter's name would give a
 * painting's answer away. It comes over the picture's foot, so nothing moves when it does (on a phone the answers are
 * right below): the licence first, linked to its deed, then the author and where it's from, two lines at most.
 */
export function QuestionPicture({
  image,
  credit,
  maxHeight = '40svh',
  className,
}: {
  image: QuestionImage;
  credit?: ImageCredit | null;
  maxHeight?: string;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const ratio = image.w / image.h;
  return (
    <figure
      className={clsx('relative mx-auto', className)}
      style={{ width: `min(100%, calc(var(--pic-h, ${maxHeight}) * ${ratio}))` }}
    >
      <div
        className={clsx(
          'relative overflow-hidden rounded-2xl border border-line bg-tint/[0.04]',
          !loaded && 'motion-safe:animate-pulse',
        )}
        style={{ aspectRatio: `${image.w} / ${image.h}` }}
      >
        <img
          src={image.src}
          srcSet={image.srcSet}
          sizes={PICTURE_SIZES}
          width={image.w}
          height={image.h}
          alt={image.alt}
          decoding="async"
          onLoad={() => setLoaded(true)}
          // Nothing to save or drag out of a question.
          draggable={false}
          className={clsx(
            'size-full object-contain transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>
      {credit && (
        <m.figcaption
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // Over the picture, on a scrim: white on dark whatever the theme, as the picture's own frame is.
          className="absolute inset-x-px bottom-px line-clamp-2 rounded-b-2xl bg-linear-to-t from-black/80 via-black/60 to-transparent px-3 pt-5 pb-1.5 text-right text-[11px] leading-snug text-white/85 [overflow-wrap:anywhere] sm:text-xs"
        >
          <Linked href={credit.licenseUrl}>{LICENSES[credit.license] ?? credit.license}</Linked>
          {' · '}
          <Linked href={credit.sourceUrl}>{credit.credit}</Linked>
          {fromCommons(credit) && ' · чрез Wikimedia Commons'}
        </m.figcaption>
      )}
    </figure>
  );
}

function Linked({ href, children }: { href?: string | null; children: string }) {
  if (!href) return children;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/** A question's picture small, beside its text in a list („Моите знания“, „Научи днес“). */
export function Thumbnail({ image }: { image: QuestionImage }) {
  return (
    <img
      src={image.src}
      alt={image.alt}
      width={image.w}
      height={image.h}
      loading="lazy"
      decoding="async"
      className="mt-0.5 h-12 w-auto max-w-20 shrink-0 rounded-lg border border-line object-cover"
    />
  );
}
