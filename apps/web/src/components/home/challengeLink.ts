import { fmt } from '@quiz/client';
import { BRAND, MODES } from '@quiz/shared';

export const challengeUrl = (id: string) => `${window.location.origin}/c/${id}`;

/** What goes into the chat with a challenge link: the score to beat (when there is one) and the link. */
export function challengeShareText(id: string, score: number | null, questions: number = MODES.challenge.questions) {
  const pitch =
    score === null
      ? `${questions} въпроса в ${BRAND.name}. Можеш ли да ме биеш?`
      : `Изкарах ${fmt(score)} ${score === 1 ? 'точка' : 'точки'} на ${questions} въпроса в ${BRAND.name}. Можеш ли повече?`;
  return `${pitch}\n${challengeUrl(id)}`;
}
