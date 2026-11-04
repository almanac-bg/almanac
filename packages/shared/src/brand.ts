/** The product's name lives here only — change it and every screen follows. */
export const BRAND = {
  name: 'АЛМАНАХ',
  /** Shown near the logo so people learn to type the Latin spelling. */
  domain: 'almanac.bg',
  tagline: 'Онлайн викторина с въпросите на деня',
  /** The mark in shared text, where a picture can't go: the rosette emoji (U+1F3F5), gold-orange on every platform. */
  mark: '🏵️',
} as const;

/** The privacy policy's and terms' versions. Who runs a site (name, address…) is its own configuration (see .env). */
export const LEGAL = {
  privacyUpdated: '4 ноември 2026 г.',
  /** What that change changed, shown at the top of the policy (§12): a line or three, the newest change only. */
  privacyChanges: [
    'Приложенията за iOS и Android: известията им минават през услугите на Apple и Google, а адреса на устройството за тях пазим само докато сесията е отворена (т. 2, 5 и 6).',
    'Приложенията в App Store и Google Play са с оценка 13+; по-малките играят през сайта (т. 10).',
  ] as string[],
  termsUpdated: '3 ноември 2026 г.',
  /** Each one's date, for the sitemap: a page's own, never the other's (COPY-11). */
  privacyIso: '2026-11-04',
  termsIso: '2026-11-03',
} as const;

/** Small print where an account is made: under 14 (Bulgaria's age of consent online) the terms ask for a parent's. */
export const MINORS_NOTICE =
  'Ако си под 14 години, за профил, за писмата по желание и за известията на устройството е нужно съгласие на родител или настойник.';
