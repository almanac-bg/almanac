import { MODERATION_BASES, type ModerationBasis } from '@quiz/shared';
import { config } from './config';
import { decisionMail, sendMail } from './mailer';
import { notify } from './notifications';
import { getUser } from './users';

/**
 * What a moderator's decision tells the people it concerns (the DSA's statement of reasons, Art. 17, and the answer to a
 * notice, Art. 16(5); the Terms, §3а, promise both). The player: what was restricted and for how long, on what basis
 * and why, whether a report led to it, that a person decided, and where to contest it — as a note in the game, and by
 * mail to a verified address. Whoever reported it: what came of it. Every decision goes through here, so none can leave
 * a part out.
 */

export const basisLabel = (basis: string | null) => MODERATION_BASES.find((b) => b.id === basis)?.label ?? null;

/** A sentence a moderator typed, ended as one. */
const sentence = (text: string) => (/[.!?…“"]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export const HUMAN = 'Решението е взето от модератор — човек, не автоматично.';

/** Where to contest a decision: us first, then a certified out-of-court body (DSA Art. 21) or a court. */
export const appealLine = () =>
  `Ако смяташ, че е грешно, отговори ни на ${config.operator.email} до 6 месеца и ще го прегледаме отново. Можеш да се обърнеш и към сертифициран орган за извънсъдебно решаване на спорове (чл. 21 от Регламента за цифровите услуги) или към съда.`;

export interface Statement {
  /** What was decided, as the player reads it first: „Модератор скри набора ти „Урок 5“: …“ */
  what: string;
  basis: ModerationBasis | null;
  reason: string;
  /** A report led to it; otherwise the moderators' own check did. */
  onReport: boolean;
  /** The mail's subject. */
  subject: string;
  icon: string;
  link?: string | null;
  /** Said after the rest (a banned player: how to get their data or have the account deleted). */
  after?: string;
}

export function statementLines(s: Statement): string[] {
  const basis = basisLabel(s.basis);
  return [
    sentence(s.what),
    `${basis ? `Основание: ${basis}. ` : ''}Причина: ${sentence(s.reason)}`,
    `${s.onReport ? 'Разгледахме го след сигнал от играч.' : 'Забелязахме го при наша проверка.'} ${HUMAN}`,
    appealLine(),
    ...(s.after ? [s.after] : []),
  ];
}

/** The statement, as a note (unless `note` is false: a banned player can't read one) and by mail when there's an address. */
export function tellPlayer(userId: number, s: Statement, { note = true } = {}) {
  const user = getUser(userId);
  if (!user) return;
  const lines = statementLines(s);
  if (note) notify(userId, { icon: s.icon, text: lines.join(' '), link: s.link ?? null });
  if (user.email && user.email_bounced_at === null) sendMail(decisionMail(user.email, user.username, s.subject, lines));
}

/** A decision taken back (from the log): the player hears it, with why, the way they heard the decision. */
export function tellReversal(userId: number, what: string, reason: string, icon = '↩️', link: string | null = null) {
  const user = getUser(userId);
  if (!user) return;
  const lines = [sentence(what), `Причина: ${sentence(reason)}`];
  notify(userId, { icon, text: lines.join(' '), link });
  if (user.email && user.email_bounced_at === null)
    sendMail(
      decisionMail(user.email, user.username, `Решение на модератор е отменено`, lines, {
        label: `Към ${new URL(config.appUrl).host}`,
        link: config.appUrl,
      }),
    );
}

/** What came of a report, as its sender reads it. */
export const OUTCOMES = {
  ban: 'профилът е спрян',
  rename: 'името е сменено',
  rename_group: 'името на групата е сменено',
  hide_set: 'наборът е скрит',
  dismiss: 'не открихме нарушение на правилата',
} as const;
export type Outcome = keyof typeof OUTCOMES;

/**
 * Everyone whose report a decision closed hears what came of it (once each), in a note. A notice of illegal content
 * is answered by mail too, when the sender has an address.
 */
export function tellReporters(
  reports: { reporter_id: number | null; reason: string }[],
  about: string,
  outcome: Outcome,
) {
  const told = new Set<number>();
  for (const r of reports) {
    if (r.reporter_id === null || told.has(r.reporter_id)) continue;
    told.add(r.reporter_id);
    const text = `Разгледахме доклада ти за „${about}“: ${OUTCOMES[outcome]}. Благодарим, че ни каза!`;
    notify(r.reporter_id, { icon: '🛡️', text });
    const user = reports.some((x) => x.reporter_id === r.reporter_id && x.reason === 'illegal')
      ? getUser(r.reporter_id)
      : undefined;
    if (user?.email && user.email_bounced_at === null)
      sendMail(
        decisionMail(user.email, user.username, 'Решение по сигнала ти', [text, HUMAN, appealLine()], {
          label: `Към ${new URL(config.appUrl).host}`,
          link: config.appUrl,
        }),
      );
  }
}

/** A notice of illegal content gets a receipt at once (DSA Art. 16(4)): it's in, and its sender will hear the decision. */
export function confirmNotice(reporterId: number, about: string) {
  notify(reporterId, {
    icon: '🛡️',
    text: `Получихме сигнала ти за незаконно съдържание в „${about}“. Модератор ще го разгледа и ще ти кажем какво решихме.`,
  });
}
