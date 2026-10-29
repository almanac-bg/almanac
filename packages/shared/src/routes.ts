// With its extension: the web build's config loads this file in Node (for the sitemap), which needs it.
import { BRAND } from './brand.ts';
import { CATEGORIES } from './categories.ts';

/**
 * The site's addresses, in one place for the server (status codes, titles in the page, what search engines may
 * index) and the web app (titles, the "page not found" screen). A test checks that every route in the app is here.
 */

/** Pages for everyone, search engines included: each has its own title and description in the page itself. */
export const PUBLIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': {
    title: `${BRAND.name} — онлайн викторина на български: 10 въпроса на деня`,
    description:
      'Безплатна онлайн викторина: 10 въпроса на деня за цяла България, дуели с приятели и Роял. Проверени въпроси с „Знаеше ли?“ след отговора. Без регистрация и реклами.',
  },
  '/privacy': {
    title: `Политика за поверителност — ${BRAND.name}`,
    description: `Какви лични данни обработва ${BRAND.name}, защо, колко дълго ги пази и какви са правата ти. Без реклами и без проследяване.`,
  },
  '/terms': {
    title: `Условия за ползване — ${BRAND.name}`,
    description: `Условията за игра в ${BRAND.name}: профил и гост, честна игра, модериране и обжалване, предложени въпроси, виртуални награди.`,
  },
  '/how-to-play': {
    title: `Как се играе — ${BRAND.name}`,
    description: `Правилата на ${BRAND.name}: как се смятат точките, козовете, въпросите на деня, Дуел, Арена, Роял, финалът с число и „Подреди“, нивата и ранговете.`,
  },
  '/quiz': {
    title: `Онлайн викторини с отговори по категории — ${BRAND.name}`,
    description: `Безплатни викторини на български по история, география, наука, кино, музика, спорт и още — с верните отговори, а към много от тях — и факт „Знаеше ли?“.`,
  },
  ...Object.fromEntries(
    CATEGORIES.map((c) => [
      `/quiz/${c.id}`,
      {
        title: `Викторина: ${c.name} — въпроси с отговори — ${BRAND.name}`,
        description: `Въпроси от „${c.name}“ с верните отговори — опитай, после играй с часовник и класация в ${BRAND.name}.`,
      },
    ]),
  ),
  '/quiz/christmas': {
    title: `Коледна викторина с отговори — ${BRAND.name}`,
    description: `Коледни въпроси с отговори: българските обичаи за Бъдни вечер и Коледа, песни, книги и традиции по света — с факт „Знаеше ли?“ към всеки.`,
  },
  '/facts': {
    title: `Знаеше ли? Интересни факти — ${BRAND.name}`,
    description: `Интересни факти от въпросите на ${BRAND.name} — от география и история до природата, всеки с източник.`,
  },
  '/teachers': {
    title: `Викторина за класната стая — ${BRAND.name} за учители`,
    description: `Стая до 40 ученици с код, голям екран за проектора, ваши въпроси и картини, без реклами и без регистрация за учениците.`,
  },
};

/** The game's own screens and the pages email links open: served to anyone, never indexed. */
const APP_PATHS = [
  /^\/game$/,
  /^\/room$/,
  /^\/join\/[^/]+$/,
  /^\/c\/[^/]+$/,
  /^\/daily(\/[^/]+)?$/,
  /^\/profile(\/[^/]+)?$/,
  /^\/achievements$/,
  /^\/locker$/,
  /^\/leaderboard$/,
  /^\/friends$/,
  /^\/almanac(\/[^/]+)?$/,
  /^\/groups(\/[^/]+)?$/,
  /^\/groups\/join\/[^/]+$/,
  /^\/sets(\/[^/]+)?$/,
  /^\/sets\/shared\/[^/]+$/,
  /^\/notifications$/,
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

/**
 * Addresses as error reports and the server's log keep them, in a URL or anywhere in a line of text: the path alone (a
 * query can carry a password-reset or unsubscribe token), and no part that names a player or opens something private —
 * a profile, a room, a link to a challenge, a day's questions, a group or a set, a set's picture, the email-events
 * secret. Numbers that only count (a group's or a set's id) stay. Linear in the text's length, whatever it holds (it
 * reads request paths and browser reports, which anyone can send).
 */
export function scrubPaths(text: string): string {
  return text
    .replace(/\S+/g, (word) => {
      // A query or fragment after a path, up to the punctuation around it ("…/c/AbC?x=1)," keeps "),").
      const slash = word.indexOf('/');
      const query = word.search(/[?#]/);
      if (slash === -1 || query < slash) return word;
      const end = word.slice(query).search(/["'`),;]/);
      return word.slice(0, query) + (end === -1 ? '' : word.slice(query + end));
    })
    .replace(
      /\/(profile|join|c|challenges|daily|groups\/join|sets\/shared|sets\/images|email-events)\/(?!(?:preview|link)(?![^/\s"'`):,;]))[^/\s"'`):,;]+/g,
      '/$1/*',
    );
}

/** A browser tab's title: "Настройки — АЛМАНАХ"; null is the home page's own. */
export function pageTitle(title: string | null): string {
  return title ? `${title} — ${BRAND.name}` : PUBLIC_PAGES['/'].title;
}
