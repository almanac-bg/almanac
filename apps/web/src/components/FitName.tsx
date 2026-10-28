import clsx from 'clsx';
import { Fragment, useLayoutEffect, useRef } from 'react';

/**
 * A player's name as a heading (3–20 letters, no spaces). It keeps its usual size when it fits on one line; otherwise
 * the font steps down until it does, but never below `min` px. Only then does it take a second line, broken after a
 * "_", "." or "-" or where letters meet digits ("Мозъчко" / "2502"), and anywhere only as the last resort. Measured,
 * not guessed: Cyrillic in the display font runs much wider than Latin.
 */
export function FitName({ name, className, min = 16 }: { name: string; className?: string; min?: number }) {
  const ref = useRef<HTMLHeadingElement>(null);

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
    <h1 ref={ref} className={clsx('line-clamp-2 [overflow-wrap:anywhere]', className)}>
      {name.split(/(?<=[_.-])|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one name, in order
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </h1>
  );
}
