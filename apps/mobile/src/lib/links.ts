import { type Href, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from './client';

/**
 * The site's paths the app has its own screen for so far. The rest open the site in the in-app browser until theirs
 * come (APP_PATHS in packages/shared lists every path the app will take).
 */
const SCREENS: readonly RegExp[] = [
  /^\/$/,
  /^\/knowledge(\/[^/]+)?$/,
  /^\/leaderboard$/,
  /^\/friends$/,
  /^\/profile(\/[^/]+)?$/,
  /^\/notifications$/,
  /^\/settings$/,
];

/** Whether the app has a screen for a site's path ("/profile/Мария", "/knowledge/history"). */
export const hasScreen = (path: string) => SCREENS.some((s) => s.test(path.split(/[?#]/, 1)[0] ?? ''));

/** A site's path, opened where it is best seen: its screen in the app, or the site in the in-app browser. */
export function openPath(path: string) {
  if (hasScreen(path)) router.push(path as Href);
  else void WebBrowser.openBrowserAsync(`${API_URL}${path}`);
}
