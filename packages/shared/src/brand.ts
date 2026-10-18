/** The product's name lives here only — change it and every screen follows. */
export const BRAND = {
  name: 'АЛМАНАХ',
  /** Shown near the logo so people learn to type the Latin spelling. */
  domain: 'almanac.bg',
  tagline: 'Куиз битки в реално време',
} as const;

/**
 * Who runs the service — shown in the privacy policy and terms.
 * TODO before launch: replace the bracketed placeholders with the real operator details.
 */
export const LEGAL = {
  operator: '[Име на физическото лице или фирмата]',
  /** Company registration number (ЕИК), if the operator is a company. */
  companyId: '[ЕИК]',
  address: '[Адрес за кореспонденция]',
  email: 'privacy@almanac.bg',
  /** Email / SMTP provider that delivers password-reset emails. */
  emailProvider: '[Доставчик на имейли, напр. Brevo (Франция)]',
  updated: '18 октомври 2026 г.',
} as const;
