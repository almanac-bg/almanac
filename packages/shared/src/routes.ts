// With its extension: the web build's config loads this file in Node (for the sitemap), which needs it.
import { BRAND } from './brand.ts';

/**
 * The site's addresses, in one place for the server (status codes, titles in the page, what search engines may
 * index) and the web app (titles, the "page not found" screen). A test checks that every route in the app is here.
 */

/** Pages for everyone, search engines included: each has its own title and description in the page itself. */
export const PUBLIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': {
    title: `${BRAND.name} — онлайн куиз битки в реално време`,
    description:
      'Безплатна онлайн викторина срещу истински хора: дуели 1 на 1, Роял за 8 и дневно предизвикателство с въпроси от обща култура до спорт. Играй и като гост.',
  },
  '/privacy': {
    title: `Политика за поверителност — ${BRAND.name}`,
    description: `Какви лични данни обработва ${BRAND.name}, защо, колко дълго ги пази и какви са правата ти. Без реклами и без проследяване.`,
  },
  '/terms': {
    title: `Условия за ползване — ${BRAND.name}`,
    description: `Условията за игра в ${BRAND.name}: профил и гост, честна игра, предложени въпроси, виртуални награди.`,
  },
};

/** The game's own screens and the pages email links open: served to anyone, never indexed. */
const APP_PATHS = [
  /^\/game$/,
  /^\/room$/,
  /^\/join\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/profile(\/[^/]+)?$/,
  /^\/achievements$/,
  /^\/locker$/,
  /^\/leaderboard$/,
  /^\/friends$/,
  /^\/submit$/,
  /^\/admin$/,
  /^\/settings$/,
  /^\/reset-password$/,
  /^\/verify-email$/,
  /^\/unsubscribe$/,
];

/** What an address is: a public page, a screen of the game, or nothing at all (a 404). */
export function routeKind(path: string): 'public' | 'app' | 'unknown' {
  if (Object.hasOwn(PUBLIC_PAGES, path)) return 'public';
  return APP_PATHS.some((re) => re.test(path)) ? 'app' : 'unknown';
}

/** A browser tab's title: "Настройки — АЛМАНАХ"; null is the home page's own. */
export function pageTitle(title: string | null): string {
  return title ? `${title} — ${BRAND.name}` : PUBLIC_PAGES['/'].title;
}
