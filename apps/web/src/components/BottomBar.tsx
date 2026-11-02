import type { ComponentProps } from 'react';
import { useBottomBar } from '../lib/bottomBar';

/** A page's own bar pinned to the foot of the screen, which the page keeps a focused field clear of (lib/bottomBar). */
export function BottomBar(props: ComponentProps<'div'>) {
  const ref = useBottomBar<HTMLDivElement>();
  return <div ref={ref} data-bottom-bar {...props} />;
}
