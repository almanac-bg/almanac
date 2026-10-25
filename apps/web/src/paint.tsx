import type { OperatorInfo } from '@quiz/shared';
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import { App } from './App';
import { setOperator } from './lib/operator';

/**
 * The pages the server sends already drawn (see lib/painted.ts), rendered by the server itself: this file is built
 * into a module of its own (dist-ssr) that the server loads at startup and calls with who runs the site.
 */
export async function paint(url: string, operator: OperatorInfo): Promise<string> {
  setOperator(operator);
  // Waits for the pages that load on demand (the legal ones), unlike a plain render to string.
  const { prelude } = await prerender(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
  );
  return new Response(prelude).text();
}
