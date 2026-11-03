// The app's link filters (app-links.json, read by app.config.ts) are the server's list of the app's screens, as of now:
// a screen added to the app (packages/shared → APP_PATHS) and not to the app's filters wouldn't open the app.
import links from '../app-links.json';
import { appLinks } from '../scripts/app-links';

test('the Android link filters are the ones the shared list makes (run `npm run app-links` at the root)', () => {
  expect(links).toEqual(appLinks());
});

test('a friend duel, a room and the day’s questions are among them; the moderators’ page is not', () => {
  const paths = links.android.map((d) => d.path ?? `${d.pathPrefix}*`);
  expect(paths).toEqual(expect.arrayContaining(['/c/*', '/join/*', '/daily', '/daily/*']));
  expect(paths).not.toContain('/admin');
});
