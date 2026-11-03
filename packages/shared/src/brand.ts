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
  privacyUpdated: '3 ноември 2026 г.',
  /** What that change changed, shown at the top of the policy (§12): a line or three, the newest change only. */
  privacyChanges: [
    'Докладите и сигналите за грешки във въпроси остават и след изтриване на профила — без името и думите ти (т. 6); и като гост вече можеш да докладваш и да блокираш.',
    'Модераторите могат да влизат в модерацията и с ключ за достъп (passkey) вместо с код: пазим публичния му ключ, устройството, на което е направен, и кога е ползван за последно (т. 2).',
  ] as string[],
  termsUpdated: '3 ноември 2026 г.',
  /** Each one's date, for the sitemap: a page's own, never the other's (COPY-11). */
  privacyIso: '2026-11-03',
  termsIso: '2026-11-03',
} as const;
