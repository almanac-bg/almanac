import type { LiveGame } from '@quiz/client';
import { FREEZE_MS } from '@quiz/shared';
import { useEffect, useState } from 'react';
import { LETTERS } from './answers';

/**
 * What a screen reader hears during a match: each question as it opens (with its options, so 1–4 can answer it right
 * away), then how it went and who dropped out. Polite, so it never cuts the reader off mid-sentence.
 */
export function MatchAnnouncer({ game }: { game: LiveGame }) {
  const [message, setMessage] = useState('');
  const q = game.question;
  const reveal = q && game.reveal?.index === q.index ? game.reveal : null;
  const youId = game.start.youId;

  // Keyed by the text itself: a resync that re-sends the same question stays quiet.
  const opening = q
    ? `Въпрос ${q.index + 1} от ${q.total}${q.elimination ? ' — след него най-слабият отпада' : ''}: ${q.q} ${q.options
        .map((o, i) => `${LETTERS[i]}) ${o}.`)
        .join(' ')}`
    : null;
  useEffect(() => {
    if (opening) setMessage(opening);
  }, [opening]);

  let outcome: string | null = null;
  if (q && reveal) {
    const right = `Верният отговор е ${LETTERS[reveal.correct]}) ${q.options[reveal.correct]}.`;
    const mine = reveal.results[youId];
    const parts = [
      !mine
        ? right // watching: out of the match already
        : mine.correct
          ? `Вярно! +${mine.points} точки.`
          : `${mine.choice === null ? 'Времето изтече.' : 'Грешно.'}${mine.points < 0 ? ` Минус ${-mine.points} точки.` : ''} ${right}`,
      ...reveal.eliminated.map((id) =>
        id === youId ? 'Ти отпадна от мача.' : `${game.players[id]?.name ?? 'Играч'} отпада.`,
      ),
    ];
    outcome = parts.join(' ');
  }
  useEffect(() => {
    if (outcome) setMessage(outcome);
  }, [outcome]);

  useEffect(() => {
    if (game.retryPrompt) setMessage('Грешно, но имаш още един опит — за половин точки.');
  }, [game.retryPrompt]);

  const frozenBy = game.frozenBy ? (game.players[game.frozenBy]?.name ?? 'Съперник') : null;
  useEffect(() => {
    if (frozenBy && game.frozenUntil > Date.now()) setMessage(`${frozenBy} те замрази за ${FREEZE_MS / 1000} секунди.`);
  }, [frozenBy, game.frozenUntil]);

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
