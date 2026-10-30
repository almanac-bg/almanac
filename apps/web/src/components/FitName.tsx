import clsx from 'clsx';
import { Fragment, type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * A player's name as a heading, or on a podium (`as="span"`): an account's 3–20 letters, or a room's name with spaces.
 * It keeps its usual size when it fits on one line; otherwise the font steps down until it does, but never below `min`
 * px. Only then does it take a second line, broken at a space, after a "_", "." or "-" or where letters meet digits
 * ("Мозъчко" / "2502"), and anywhere only as the last resort. Measured, not guessed: Cyrillic runs much wider than
 * Latin. A span needs a box of its own (a flex item, or `block`) to be measured against.
 */
export function FitName({
  name,
  className,
  min = 16,
  as: Tag = 'h1',
}: {
  name: string;
  className?: string;
  min?: number;
  as?: 'h1' | 'span';
}) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const column = el?.parentElement;
    if (!el || !column) return;
    let width = -1;
    const fit = () => {
      // Only a change of width can change the fit (the heading's own height changes as it does).
      if (column.clientWidth === width) return;
      width = column.clientWidth;
      el.style.fontSize = '';
      // The name on one line, measured on a hidden copy (the heading itself may wrap at its <wbr>s while measured).
      const probe = document.createElement('span');
      probe.textContent = name;
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
      el.append(probe);
      let size = Number.parseFloat(getComputedStyle(el).fontSize);
      while (size > min && probe.getBoundingClientRect().width > el.clientWidth + 0.5) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
      probe.remove();
    };
    fit();
    // Refitted in the next frame, not in the observer's own callback: changing the size there resizes the column again
    // in the same frame, which Safari reports as an observer loop (and lays the heading out twice).
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(column);
    // Measured in the fallback font, a name fits that the display font (wider, loaded later) breaks: once more then.
    let live = true;
    document.fonts?.ready.then(() => {
      if (!live) return;
      width = -1;
      fit();
    });
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [name, min]);

  return (
    <Tag
      ref={ref as RefObject<HTMLHeadingElement>}
      className={clsx('line-clamp-2 [overflow-wrap:anywhere]', className)}
    >
      <Breakable name={name} />
    </Tag>
  );
}

/**
 * A name in a list or a row: whole, on two lines at most (a 20-letter name doesn't fit a phone's row at the usual
 * size), broken where FitName breaks one — instead of cut off with "…".
 */
export function PlayerName({ name, className }: { name: string; className?: string }) {
  return (
    <span className={clsx('line-clamp-2 min-w-0 [overflow-wrap:anywhere]', className)}>
      <Breakable name={name} />
    </span>
  );
}

/** The name with line-break chances after "_", "." and "-", and where letters meet digits. */
function Breakable({ name }: { name: string }) {
  return name.split(/(?<=[_.-])|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u).map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one name, in order
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
