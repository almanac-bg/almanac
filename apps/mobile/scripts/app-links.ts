// The app's link filters, from the server's list of the app's screens (packages/shared → appLinkPatterns, the same
// list /.well-known/apple-app-site-association serves). Android declares them in the app (intent filters): this
// writes them to app-links.json, which app.config.ts reads. Run from the repository: `npm run app-links`.
// __tests__/app-links.test.ts fails while the file is out of date.
import fs from 'node:fs';
import path from 'node:path';
import { appLinkPatterns } from '../../../packages/shared/src/routes';

/** An intent filter's `data` for each pattern: an exact path, a prefix (`/c/*`), or Android's own pattern syntax. */
export function androidData(patterns: string[]) {
  return patterns.map((pattern) => {
    const star = pattern.indexOf('*');
    if (star === -1) return { scheme: 'https', host: 'almanac.bg', path: pattern };
    if (star === pattern.length - 1 && pattern.endsWith('/*'))
      return { scheme: 'https', host: 'almanac.bg', pathPrefix: pattern.slice(0, -1) };
    return { scheme: 'https', host: 'almanac.bg', pathPattern: pattern.replaceAll('*', '.*') };
  });
}

export const appLinks = () => ({ android: androidData(appLinkPatterns()) });

// Run as a script (not imported by the test, where there's no import.meta.dirname).
const here = import.meta.dirname;
if (here && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here, 'app-links.ts')) {
  const file = path.resolve(here, '../app-links.json');
  fs.writeFileSync(file, `${JSON.stringify(appLinks(), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
