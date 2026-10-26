/** The product's name lives here only — change it and every screen follows. */
export const BRAND = {
  name: 'АЛМАНАХ',
  /** Shown near the logo so people learn to type the Latin spelling. */
  domain: 'almanac.bg',
  tagline: 'Куиз битки в реално време',
} as const;

/** The privacy policy's and terms' version. Who runs a site (name, address…) is its own configuration (see .env). */
export const LEGAL = {
  updated: '26 октомври 2026 г.',
  /** The same day, for the sitemap. */
  updatedIso: '2026-10-26',
} as const;
