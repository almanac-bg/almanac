/** The product's name lives here only — change it and every screen follows. */
export const BRAND = {
  name: 'АЛМАНАХ',
  /** Shown near the logo so people learn to type the Latin spelling. */
  domain: 'almanac.bg',
  tagline: 'Онлайн викторина с въпросите на деня',
} as const;

/** The privacy policy's and terms' versions. Who runs a site (name, address…) is its own configuration (see .env). */
export const LEGAL = {
  privacyUpdated: '30 октомври 2026 г.',
  termsUpdated: '29 октомври 2026 г.',
  /** The later of the two, for the sitemap. */
  updatedIso: '2026-10-30',
} as const;
