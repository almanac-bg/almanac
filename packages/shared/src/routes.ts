// With its extension: the web build's config loads this file in Node (for the sitemap), which needs it.
import { BRAND } from './brand.ts';
import { CATEGORIES, type CategoryId } from './categories.ts';

/**
 * The site's addresses, in one place for the server (status codes, titles in the page, what search engines may
 * index) and the web app (titles, the "page not found" screen). A test checks that every route in the app is here.
 */

/** Pages for everyone, search engines included: each has its own title and description in the page itself. */
/**
 * What each category's questions are about, in a few words: its page's description and lead (one template with the
 * name swapped in made ten near-duplicate pages, which search engines rank weakly).
 */
export const CATEGORY_ABOUT: Record<CategoryId, string> = {
  general: 'всичко по малко — от всекидневието до световните рекорди',
  science: 'физика, химия, космос, изобретения и откриватели',
  history: 'ханове и царе, Възраждането, Освобождението и XX век — у нас и по света',
  geography: 'столици, планини, реки, знамена и места по света и у нас',
  movies: 'филми, сериали, актьори и наградите им',
  music: 'песни, изпълнители, групи и инструменти — от народната музика до попа',
  sports: 'футбол, олимпийски игри, рекорди и шампиони',
  technology: 'компютри, интернет, изобретения и видеоигри',
  literature: 'книги, писатели и поети, картини и художници',
  nature: 'животни, растения, човешкото тяло и рекордите на природата',
};

export const PUBLIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': {
    title: `${BRAND.name} — онлайн викторина на български: 10 въпроса на деня`,
    description:
      'Безплатна онлайн викторина: 10 въпроса на деня за цяла България, дуели с приятели и Роял, „Знаеше ли?“ след много от отговорите. Без регистрация и реклами.',
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
        description: `Викторина „${c.name}“: ${CATEGORY_ABOUT[c.id]}. С верните отговори — опитай, после играй в ${BRAND.name}.`,
      },
    ]),
  ),
  '/quiz/levski': {
    title: `Викторина за Васил Левски с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за Апостола на свободата: животът му, комитетите, идеите му за свободна България и паметта за него — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/liberation-day': {
    title: `Викторина за 3 март и Освобождението с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за Освобождението: Руско-турската война от 1877–1878 г., боевете, мирът и паметниците — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/alphabet-day': {
    title: `Викторина за 24 май: Кирил и Методий и азбуката, с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за 24 май, деня на българската азбука, просвета и култура: Кирил и Методий, двете славянски азбуки, учениците им и нашите букви.`,
  },
  '/quiz/botev': {
    title: `Викторина за Христо Ботев с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за 2 юни: поетът и революционерът Христо Ботев, стиховете и вестниците му, четата и пътят ѝ — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/unification-day': {
    title: `Викторина за Съединението с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за 6 септември: заговорът, войната, която защитава Съединението, и дипломацията след нея — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/independence-day': {
    title: `Викторина за 22 септември и Независимостта с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за 22 септември 1908 г.: как е обявена Независимостта, кое прави момента удобен и как светът я признава — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/enlighteners-day': {
    title: `Викторина за Деня на народните будители с отговори — ${BRAND.name}`,
    description: `Въпроси с отговори за 1 ноември: възрожденските книжовници и учители, първите училища и как денят става празник — с факт „Знаеше ли?“ към всеки.`,
  },
  '/quiz/christmas': {
    title: `Коледна викторина с отговори — ${BRAND.name}`,
    description: `Коледни въпроси с отговори: българските обичаи за Бъдни вечер и Коледа, песни, книги и традиции по света — с факт „Знаеше ли?“ към всеки.`,
  },
  '/facts': {
    title: `Знаеше ли? Интересни факти — ${BRAND.name}`,
    description: `Интересни факти от въпросите на ${BRAND.name} — от география и история до природата, всеки с източник.`,
  },
  '/delete-account': {
    title: `Изтриване на профила — ${BRAND.name}`,
    description: `Как да изтриеш профила си в ${BRAND.name} — от сайта, от приложението или без вход — и какво остава след това.`,
  },
  '/teachers': {
    title: `Викторина за класната стая — ${BRAND.name} за учители`,
    description: `Стая до 40 ученици с код, голям екран за проектора, ваши въпроси и картини, без реклами и без регистрация за учениците.`,
  },
};

/**
 * The game's own screens and the pages email links open: served to anyone, never indexed. Each says where it is:
 * `app: true` — a screen the native app has too, and its links open the app (8o: apple-app-site-association and
 * assetlinks are made from these); `app: false` — the web's alone. A new path says which, consciously: the field is
 * required, so the type checker asks (the 31 October review, MOBILE-2).
 */
export const APP_PATHS: readonly { path: RegExp; app: boolean }[] = [
  { path: /^\/game$/, app: true },
  { path: /^\/room$/, app: true },
  { path: /^\/class$/, app: false },
  { path: /^\/join\/[^/]+$/, app: true },
  { path: /^\/c\/[^/]+$/, app: true },
  { path: /^\/daily(\/[^/]+)?$/, app: true },
  { path: /^\/profile(\/[^/]+)?$/, app: true },
  { path: /^\/achievements$/, app: true },
  { path: /^\/locker$/, app: true },
  { path: /^\/leaderboard$/, app: true },
  { path: /^\/friends$/, app: true },
  { path: /^\/knowledge(\/[^/]+)?$/, app: true },
  { path: /^\/groups(\/[^/]+)?$/, app: true },
  { path: /^\/groups\/join\/[^/]+$/, app: true },
  { path: /^\/sets(\/[^/]+)?$/, app: true },
  { path: /^\/sets\/shared\/[^/]+$/, app: true },
  { path: /^\/notifications$/, app: true },
  { path: /^\/submit$/, app: true },
  { path: /^\/admin$/, app: false },
  { path: /^\/settings$/, app: true },
  { path: /^\/reset-password$/, app: false },
  { path: /^\/verify-email$/, app: false },
  { path: /^\/unsubscribe$/, app: false },
];

/** What an address is: a public page, a screen of the game, or nothing at all (a 404). */
/**
 * The app's links: every `app: true` path of APP_PATHS as the patterns Apple's apple-app-site-association and Android's
 * intent filters take (`*`, any characters). Read from the path's own expression — `\/` a slash, `[^/]+` a `*`, an
 * optional `(…)?` both with and without it — so the list can't drift from the app's screens; an expression written any
 * other way throws instead of going missing from the links.
 */
export function appLinkPatterns(): string[] {
  return APP_PATHS.filter((p) => p.app).flatMap(({ path }) => {
    const body = /^\^(.*)\$$/.exec(path.source)?.[1];
    if (body === undefined) throw new Error(`An app path needs ^…$: ${path}`);
    const optional = /\((.*)\)\?$/.exec(body);
    const variants = optional ? [body.slice(0, optional.index), body.slice(0, optional.index) + optional[1]] : [body];
    return variants.map((variant) => {
      const pattern = variant.replaceAll('\\/', '/').replaceAll('[^/]+', '*');
      if (!/^(\/[a-z-]+|\/\*)+$/.test(pattern)) throw new Error(`An app path the links can't read: ${path}`);
      return pattern;
    });
  });
}

export function routeKind(path: string): 'public' | 'app' | 'unknown' {
  if (Object.hasOwn(PUBLIC_PAGES, path)) return 'public';
  return APP_PATHS.some(({ path: re }) => re.test(path)) ? 'app' : 'unknown';
}

/**
 * The code a public page needs to come alive, as the web app splits it: its page file (the landing's sign-in, the
 * legal pages or the guides) and the quiz it shows — a holiday's own questions (by its slug) or the public sample.
 * The app loads them before it hydrates the drawn page, and the web build lists their files for the server, which
 * names them in the page so the browser fetches them with it (the 31 October review, WEB-6 and WEB-7).
 */
export function publicPageCode(path: string): { page: 'auth' | 'legal' | 'guide'; quiz?: string } | null {
  if (path === '/') return { page: 'auth' };
  if (path === '/privacy' || path === '/terms' || path === '/delete-account') return { page: 'legal' };
  if (routeKind(path) !== 'public') return null;
  if (path === '/facts') return { page: 'guide', quiz: 'sample' };
  const slug = /^\/quiz\/([a-z-]+)$/.exec(path)?.[1];
  if (!slug) return { page: 'guide' };
  return { page: 'guide', quiz: CATEGORIES.some((c) => c.id === slug) ? 'sample' : slug };
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
