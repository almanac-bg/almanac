import { BRAND, type DuelEntry, type DuelStanding, MODES } from '@almanac/shared';
import { fmt } from './format';

/** "остават 21 ч.", "остава 1 мин.": how long the second of a duel has to play it. */
export function timeLeft(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'времето изтече';
  const hours = Math.floor(ms / 3_600_000);
  const [n, unit] = hours >= 1 ? [hours, 'ч.'] : [Math.max(1, Math.ceil(ms / 60_000)), 'мин.'];
  return `${n === 1 ? 'остава' : 'остават'} ${n} ${unit}`;
}

export const DUEL_OUTCOME = { won: 'Победа', lost: 'Загуба', draw: 'Равенство' } as const;

/** A duel head to head, from your side: how it ended, or whose turn it is and for how long. */
export function duelStatus(standing: DuelStanding, now: number): string {
  const { friend, mine, outcome, expired } = standing;
  if (outcome) return DUEL_OUTCOME[outcome];
  if (expired) return mine ? `${friend.username} не го изигра навреме` : 'Времето изтече';
  return mine
    ? `Чакаме ${friend.username} · ${timeLeft(standing.expiresAt, now)}`
    : `Твой ред · ${timeLeft(standing.expiresAt, now)}`;
}

/** A duel in a list, in a line: what there is to beat and for how long, or how it ended. */
export function duelLine(duel: DuelEntry, now: number): string {
  switch (duel.state) {
    case 'yours':
      return `${duel.theirs ? `${fmt(duel.theirs.score)} т. за биене` : 'Ти започваш'} · ${timeLeft(duel.expiresAt, now)}`;
    case 'theirs':
      return `Чакаме — ${timeLeft(duel.expiresAt, now)}`;
    case 'expired':
      return duel.mine ? 'Не го изигра навреме' : 'Времето изтече';
    default:
      return duel.outcome && duel.mine && duel.theirs
        ? `${DUEL_OUTCOME[duel.outcome]} · ${fmt(duel.mine.score)} : ${fmt(duel.theirs.score)}`
        : 'Изиграно';
  }
}

/** The ones waiting for you first, then the ones waiting for them, then the results; newest first in each. */
export function sortDuels(duels: DuelEntry[]): DuelEntry[] {
  const order = { yours: 0, theirs: 1, done: 2, expired: 3 } as const;
  return [...duels].sort((a, b) => order[a.state] - order[b.state] || b.createdAt - a.createdAt);
}

/**
 * What goes into the chat with a challenge link: the score to beat (when there is one) and the link (`origin`: the
 * site's address, as the page or the app knows it).
 */
export function challengeShareText(
  origin: string,
  id: string,
  score: number | null,
  questions: number = MODES.challenge.questions,
) {
  const pitch =
    score === null
      ? `${questions} въпроса в ${BRAND.name}. Можеш ли да ме биеш?`
      : `Изкарах ${fmt(score)} ${score === 1 ? 'точка' : 'точки'} на ${questions} въпроса в ${BRAND.name}. Можеш ли повече?`;
  return `${pitch}\n${origin}/c/${id}`;
}
