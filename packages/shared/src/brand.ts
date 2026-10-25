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
export const LEGAL = {
  /** Full name of the person running the service. */
  operator: '[Име и фамилия]',
  /** Where letters reach you. It needn't be your home: a P.O. box or another address you can receive mail at works. */
  address: '[Адрес за кореспонденция]',
  email: 'privacy@almanac.bg',
  /** Email / SMTP provider that delivers password-reset emails. */
  emailProvider: '[Доставчик на имейли, напр. Brevo (Франция)]',
  /** Where the server and backups run (company and country). */
  hosting: '[Хостинг, напр. Hetzner Online GmbH (Германия)]',
  updated: '25 октомври 2026 г.',
} as const;
