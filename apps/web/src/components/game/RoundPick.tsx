import { actions, type LiveGame, useNow } from '@quiz/client';
import { type CategoryId, categoryById, ROUNDS } from '@quiz/shared';
import clsx from 'clsx';
import { m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useMatchKeysOn } from '../../lib/matchKeys';
import { Emoji } from '../Emoji';
import { Spinner } from '../ui';
import { KeyHint } from './Powerups';

/**
 * Before a round: whoever is behind picks its category from three (1–3 on a keyboard), within a few seconds; everyone
 * else watches them pick. Then the round's category, until its first question.
 */
export function RoundPick({ game }: { game: LiveGame }) {
  const pick = game.pick!;
  const youId = game.start.youId;
  const mine = pick.pickerId === youId && !game.eliminated.includes(youId);
  const picker = game.players[pick.pickerId];
  const decided = pick.chosen !== null;
  const now = useNow(100, !decided);
  const left = Math.max(0, pick.endsAt - now);
  const drawn = decided && game.rounds[pick.round]?.pickedBy === null;
  const chosen = decided ? categoryById(pick.chosen!) : null;
  // Yours to pick: the focus on the first category (it was left on the page), the choice said by MatchAnnouncer.
  const tiles = useRef<HTMLDivElement>(null);
  const yours = mine && !decided;
  useEffect(() => {
    if (yours) tiles.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [yours]);

  const title = chosen ? (
    <>
      <Emoji e={chosen.icon} /> {chosen.name}
    </>
  ) : mine ? (
    'Избери категория'
  ) : (
    `${picker?.name ?? 'Съперникът'} избира…`
  );
  const note = decided
    ? drawn
      ? 'Никой не избра навреме — изтеглихме я.'
      : pick.pickerId === youId
        ? 'Ти я избра.'
        : `${picker?.name ?? 'Съперникът'} я избра.`
    : mine
      ? `Изоставаш, затова избираш ти: следващите ${ROUNDS.size} въпроса са от нея.`
      : `Изостава с точките, затова избира категорията на следващите ${ROUNDS.size} въпроса.`;

  return (
    <m.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="mx-auto flex max-w-3xl flex-col items-center py-6 text-center short:py-2"
    >
      <p className="t-eyebrow text-fg-3">
        Рунд {pick.round + 1} от {game.rounds.length}
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold text-balance sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-balance text-fg-2 sm:text-base">{note}</p>

      {!decided && (
        <div
          className="mt-5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-tint/10"
          role="timer"
          aria-label={`Остават ${Math.ceil(left / 1000)} секунди`}
        >
          <div
            className="h-full rounded-full bg-violet-400 transition-[width] duration-100 ease-linear"
            style={{ width: `${(left / pick.durationMs) * 100}%` }}
          />
        </div>
      )}

      <div ref={tiles} className="mt-6 grid w-full gap-3 sm:grid-cols-3">
        {pick.options.map((id, i) => (
          <Tile
            key={id}
            id={id}
            index={i}
            mine={mine && !decided}
            sending={pick.sent === id && !decided}
            chosen={pick.chosen === id}
            faded={(decided && pick.chosen !== id) || (!!pick.sent && pick.sent !== id)}
          />
        ))}
      </div>
    </m.section>
  );
}

function Tile({
  id,
  index,
  mine,
  sending,
  chosen,
  faded,
}: {
  id: CategoryId;
  index: number;
  mine: boolean;
  sending: boolean;
  chosen: boolean;
  faded: boolean;
}) {
  const keys = useMatchKeysOn();
  const cat = categoryById(id)!;
  const body = (
    <>
      <span className="text-4xl short:text-3xl" aria-hidden>
        <Emoji e={cat.icon} />
      </span>
      <span className="text-lg font-extrabold">{cat.name}</span>
      {sending && <Spinner className="absolute top-3 right-3 size-4" />}
      {mine && !sending && <KeyHint className="absolute top-3 right-3">{String(index + 1)}</KeyHint>}
    </>
  );
  const className = clsx(
    'relative flex flex-col items-center justify-center gap-2 rounded-3xl border px-4 py-6 transition-[opacity,box-shadow,transform] duration-200 short:py-4 max-sm:flex-row max-sm:justify-start max-sm:gap-4 max-sm:py-4',
    chosen ? 'scale-[1.03]' : faded && 'opacity-35',
  );
  const style = {
    borderColor: chosen ? cat.color : `${cat.color}55`,
    background: `${cat.color}${chosen ? '26' : '12'}`,
    boxShadow: chosen ? `0 0 40px -8px ${cat.color}` : undefined,
  };
  return (
    <m.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index }}
      className="grid"
    >
      {mine ? (
        // 1–3 pick on a keyboard: the match's answer keys click whatever has data-answer.
        <button
          type="button"
          data-answer={index}
          aria-keyshortcuts={keys ? String(index + 1) : undefined}
          onClick={() => actions.pickCategory(id)}
          className={clsx(className, 'focus-ring hover:-translate-y-[3px] motion-reduce:hover:translate-y-0')}
          style={style}
        >
          {body}
        </button>
      ) : (
        <div className={className} style={style}>
          {body}
        </div>
      )}
    </m.div>
  );
}
