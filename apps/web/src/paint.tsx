import type { OperatorInfo } from '@quiz/shared';
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import { App } from './App';
import { setOperator } from './lib/operator';
import { drawAs } from './lib/painted';

/**
 * The pages the server sends already drawn (see lib/painted.ts), rendered by the server itself: this file is built
 * into a module of its own (dist-ssr) that the server loads at startup and calls with who runs the site. `returning`:
 * the landing page's version for a device that has signed in before. The tree is the client's (main.tsx) minus what
 * renders nothing, so that the browser can hydrate the result.
 */
export async function paint(url: string, operator: OperatorInfo, version = { returning: false }): Promise<string> {
  setOperator(operator);
  drawAs(version);
  // Waits for the pages that load on demand (the legal ones), unlike a plain render to string. Nothing outlined: React
  // otherwise sends a page section over ~12 KB as a spinner plus a script that swaps it in, and without scripts (a
  // search engine, a slow phone) the spinner would be all there is.
  const { prelude } = await prerender(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  );
  return new Response(prelude).text();
}
