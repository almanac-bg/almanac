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
  privacyUpdated: '2 ноември 2026 г.',
  /** What that change changed, shown at the top of the policy (§12): a line or three, the newest change only. */
  privacyChanges: [
    'Историята на мачовете има граници: редовете на ботовете се махат след 30 дни, мачовете — след две години (т. 6).',
    'Спрян профил сам може да изтегли данните си или да се изтрие при вход с паролата (т. 8); известията на устройството искат потвърждение, че си на 14, както писмата по желание (т. 10).',
    'Уточнения: кои писма пращаме, за какво служи IP адресът, колко пазим писмата до нас и на какво основание са записите на мачовете (т. 2, 3, 5, 6).',
  ] as string[],
  termsUpdated: '2 ноември 2026 г.',
  /** Each one's date, for the sitemap: a page's own, never the other's (COPY-11). */
  privacyIso: '2026-11-02',
  termsIso: '2026-11-02',
} as const;
