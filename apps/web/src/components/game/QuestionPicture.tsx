import type { ImageCredit, QuestionImage } from '@quiz/shared';
import clsx from 'clsx';
import { m } from 'motion/react';
import { useState } from 'react';

/**
 * How wide a question's picture shows, for the browser to pick a size by (the preload in main.tsx picks with the same,
 * so the file fetched during the reveal before is the one used).
 */
export const PICTURE_SIZES = '(min-width: 768px) 720px, 100vw';

const LICENSES: Record<string, string> = { PD: 'обществено достояние' };

/** Whose a picture is: „Иван Мърквичка · обществено достояние“, „Ivo Ivanov · CC BY-SA 4.0“. */
export const creditText = (c: ImageCredit) => `${c.credit} · ${LICENSES[c.license] ?? c.license}`;

/**
 * A question's picture: as large as it fits, at most `maxHeight` of the screen (40% in a match, so the question and its
 * options still fit on a phone), its box kept while it loads so nothing below it jumps. Whose it is shows once the
 * answer is out (`credit`): a painter's name would give a painting's answer away.
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
    <figure className={clsx('mx-auto', className)} style={{ width: `min(100%, calc(${maxHeight} * ${ratio}))` }}>
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
          className="mt-1.5 truncate text-right text-xs text-fg-3"
        >
          {credit.sourceUrl ? (
            <a
              href={credit.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              {creditText(credit)}
            </a>
          ) : (
            creditText(credit)
          )}
        </m.figcaption>
      )}
    </figure>
  );
}

/** A question's picture small, beside its text in a list (the almanac, „Научи днес“). */
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
