/** The product's name lives here only — change it and every screen follows. */
export const BRAND = {
  name: 'АЛМАНАХ',
  /** Shown near the logo so people learn to type the Latin spelling. */
  domain: 'almanac.bg',
  tagline: 'Куиз битки в реално време',
} as const;

/**
 * Who runs the service (a private individual, not a company) — shown in the privacy policy and terms.
 * TODO before launch: replace the bracketed placeholders with the real details.
 */
/** The privacy policy's and terms' version. Who runs a site (name, address…) is its own configuration (see .env). */
export const LEGAL = {
  updated: '25 октомври 2026 г.',
} as const;
