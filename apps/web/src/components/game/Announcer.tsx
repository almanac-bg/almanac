import { fmt, type LiveGame, plural } from '@quiz/client';
import { categoryById, MODES, ordinal } from '@quiz/shared';
import { useEffect, useState } from 'react';
import { LETTERS } from './answers';
import { numberText } from './numbers';
import { orderValueText } from './OrderQuestion';

/**
 * What a screen reader hears during a match: what it is as it starts, each question as it opens (with its options, so
 * 1–4 can answer it right away), then how it went, where you stand and who dropped out. Polite, so it never cuts the
 * reader off mid-sentence.
 */
export function MatchAnnouncer({ game }: { game: LiveGame }) {
  const [message, setMessage] = useState('');
  const q = game.question;
  const reveal = q && game.reveal?.index === q.index ? game.reveal : null;
  const youId = game.start.youId;

  // The match as it starts: what, against whom, how long (a resync mid-match has no countdown and says nothing).
  const { start } = game;
  const rivals = start.players.filter((p) => p.id !== youId).map((p) => p.name);
  const category = start.category === 'mixed' ? null : categoryById(start.category)?.name;
  const intro =
    game.phase === 'countdown'
      ? [
          `${MODES[start.mode].name}${category ? `: ${category}` : ''}.`,
          rivals.length === 1 ? `Срещу ${rivals[0]}.` : rivals.length > 1 ? `${start.players.length} играчи.` : null,
          `${plural(start.totalQuestions, 'въпрос', 'въпроса')}. Започва след малко.`,
        ]
          .filter(Boolean)
          .join(' ')
      : null;
  useEffect(() => {
    if (intro) setMessage(intro);
  }, [intro]);

  // Keyed by the text itself: a resync that re-sends the same question stays quiet.
  const opening = q
    ? `${q.final ? 'Финал. ' : ''}Въпрос ${q.index + 1} от ${q.total}${
        q.elimination ? ' — след него най-слабият отпада' : ''
      }: ${q.image ? `Картина: ${q.image.alt}. ` : ''}${q.q} ${
        q.number
          ? `Напиши число между ${numberText(q.number.min, q.number)} и ${numberText(q.number.max, q.number)}.`
          : q.order
            ? `Подреди, като ги избереш едно след друго (1 до 4), после Enter: ${q.order.items
                .map((o, i) => `${LETTERS[i]}) ${o}.`)
                .join(' ')}`
            : q.options.map((o, i) => `${LETTERS[i]}) ${o}.`).join(' ')
      }`
    : null;
  useEffect(() => {
    if (opening) setMessage(opening);
  }, [opening]);

  let outcome: string | null = null;
  if (q && reveal) {
    const answerOrder = reveal.answerOrder;
    const right =
      q.number && reveal.answerNumber !== undefined
        ? `Отговорът е ${numberText(reveal.answerNumber, q.number)}.`
        : q.order && answerOrder
          ? `Правилният ред: ${answerOrder.order
              .map((i) =>
                answerOrder.values
                  ? `${q.order!.items[i]} (${orderValueText(answerOrder.values[i], answerOrder.unit)})`
                  : q.order!.items[i],
              )
              .join(', ')}.`
          : `Верният отговор е ${LETTERS[reveal.correct]}) ${q.options[reveal.correct]}.`;
    const mine = reveal.results[youId];
    const guess = mine?.number?.guess ?? null;
    const parts = [
      !mine
        ? right // watching: out of the match already
        : q.number && reveal.answerNumber !== undefined
          ? guess === null
            ? `Времето изтече. ${right}`
            : `${right} Ти написа ${numberText(guess, q.number)}: +${mine.points} точки.`
          : q.order && answerOrder
            ? !mine.order?.given
              ? `Времето изтече. ${right}`
              : `${mine.correct ? 'Всичко на място!' : `${mine.order.right} от 4 на място.`} +${mine.points} точки. ${right}`
            : mine.correct
              ? `Вярно! +${mine.points} точки.`
              : `${mine.choice === null ? 'Времето изтече.' : 'Грешно.'}${mine.points < 0 ? ` Минус ${-mine.points} точки.` : ''} ${right}`,
      ...reveal.eliminated.map((id) =>
        id === youId ? 'Ти отпадна от мача.' : `${game.players[id]?.name ?? 'Играч'} отпада.`,
      ),
      standing(game),
    ];
    outcome = parts.join(' ');
  }
  useEffect(() => {
    if (outcome) setMessage(outcome);
  }, [outcome]);

  useEffect(() => {
    if (game.retryPrompt) setMessage('Грешно, но имаш още един опит — за половин точки.');
  }, [game.retryPrompt]);

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}

/** Where you stand after a reveal, with others in the match: your place and points, and who leads or follows. */
function standing(game: LiveGame): string | null {
  const youId = game.start.youId;
  if (game.start.players.length < 2) return null;
  const me = game.standings.find((s) => s.id === youId);
  if (!me || me.eliminatedAt !== null || me.left) return null;
  const name = (id: string) => game.players[id]?.name ?? 'Играч';
  const inPlay = game.standings.filter((s) => s.eliminatedAt === null && !s.left);
  const ahead = [...game.standings].sort((a, b) => a.rank - b.rank);
  const leader = ahead.find((s) => s.id !== youId && s.rank === 1);
  const next = ahead.find((s) => s.id !== youId);
  const yours = plural(me.score, 'точка', 'точки');
  const of = game.start.eliminationSchedule.length ? ` от ${inPlay.length} в играта` : '';
  if (me.rank === 1 && !leader)
    return next ? `Водиш с ${yours}, пред ${name(next.id)} с ${fmt(next.score)}.` : `Водиш с ${yours}.`;
  return `На ${ordinal(me.rank)} място си${of}, с ${yours}. Води ${name((leader ?? next)!.id)} с ${fmt((leader ?? next)!.score)}.`;
}
