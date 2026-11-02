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
  privacyUpdated: '30 октомври 2026 г.',
  termsUpdated: '31 октомври 2026 г.',
  /** The later of the two, for the sitemap. */
  updatedIso: '2026-10-31',
} as const;
