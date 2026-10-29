import { actions, fmt, type LiveGame, ordinal, useNow } from '@quiz/client';
import { categoryById, type FinalStanding, type Standing } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { keepTogether } from '../../lib/typography';
import { Avatar } from '../Avatar';
import { Button } from '../ui';
import { LETTERS, OPTION_COLORS } from './answers';
import { numberText } from './numbers';
import { orderValueText } from './OrderQuestion';
import { QuestionPicture } from './QuestionPicture';

/**
 * „Само водя“: a room's host runs the match on a big screen (a projector, a TV) while everyone answers on their phones.
 * The question large, how many have answered, then how many picked each option, the fact, and the top five.
 */
export function PresenterScreen({ game }: { game: LiveGame }) {
  const navigate = useNavigate();
  const now = useNow(250);
  const playing = game.start.players.length;
  const q = game.question;
  const reveal = q && game.reveal?.index === q.index ? game.reveal : null;
  const end = game.phase === 'ended' ? game.end : null;
  const back = () => {
    actions.closeGame();
    navigate('/room');
  };

  return (
    <div className="flex min-h-dvh flex-col bg-ink px-6 py-5 lg:px-12 lg:py-8">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {game.start.roomCode && (
          <p className="font-mono text-2xl font-bold tracking-[0.25em] text-fg-2 lg:text-3xl">{game.start.roomCode}</p>
        )}
        <p className="inline-flex items-center gap-2 text-fg-3">
          <Users aria-hidden className="size-5" /> {playing} {playing === 1 ? 'играч' : 'играчи'}
        </p>
        {q && !end && (
          <p className="ml-auto font-display text-xl font-bold text-fg-2 lg:text-2xl">
            Въпрос {q.index + 1} от {q.total}
          </p>
        )}
        {end && (
          <Button className="ml-auto" onClick={back}>
            Обратно в стаята
          </Button>
        )}
      </header>

      {end ? (
        <FinalBoard game={game} standings={end.standings} />
      ) : game.phase === 'countdown' ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="font-display text-4xl font-black lg:text-6xl">Започваме!</p>
            <p className="mt-6 font-display text-[clamp(5rem,15vw,12rem)] leading-none font-black text-gradient">
              {Math.max(0, Math.ceil((game.countdownEndsAt - now) / 1000)) || 'Старт!'}
            </p>
            <p className="mt-6 text-xl text-fg-2">Отговаряте от телефоните си.</p>
          </div>
        </div>
      ) : game.phase === 'pick' && game.pick ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="t-eyebrow text-fg-3">Рунд {game.pick.round + 1}</p>
            <p className="mt-3 font-display text-3xl font-black lg:text-5xl">
              {game.players[game.pick.pickerId]?.name ?? 'Последният'} избира категорията
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              {game.pick.options.map((c) => {
                const cat = categoryById(c)!;
                return (
                  <span
                    key={c}
                    className="rounded-3xl border-2 px-6 py-4 font-display text-2xl font-bold"
                    style={{ borderColor: cat.color, color: cat.color }}
                  >
                    {cat.icon} {cat.name}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ) : q ? (
        <div className="mt-6 grid flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0">
            <p
              className="font-semibold"
              style={{ color: game.start.questionSet ? undefined : categoryById(q.category)?.color }}
            >
              {game.start.questionSet
                ? `📝 ${game.start.questionSet}`
                : `${categoryById(q.category)?.icon} ${categoryById(q.category)?.name}`}
              {q.final && <span className="ml-3 text-amber-200">🎯 Финал</span>}
            </p>
            <h1 className="mt-3 font-display text-[clamp(1.75rem,3.6vw,3.25rem)] leading-tight font-bold text-balance">
              {keepTogether(q.q)}
            </h1>
            {!reveal && (
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#22d3ee)] transition-[width] duration-300 ease-linear"
                  style={{ width: `${Math.max(0, (game.deadline - now) / q.durationMs) * 100}%` }}
                />
              </div>
            )}
            {/* A picture beside the options on a wide screen, so the room reads both, and the fact still fits. */}
            <div className={clsx(q.image && 'mt-6 xl:grid xl:grid-cols-2 xl:items-start xl:gap-8')}>
              {q.image && (
                <QuestionPicture image={q.image} credit={reveal?.credit} maxHeight="50svh" className="!mx-0" />
              )}
              {q.kind === 'number' ? (
                <NumberReveal game={game} />
              ) : q.kind === 'order' ? (
                <OrderOnScreen game={game} />
              ) : (
                <ul className={clsx('grid gap-4', q.image ? 'mt-6 xl:mt-0' : 'mt-8 md:grid-cols-2')}>
                  {q.options.map((text, i) => {
                    const picks = reveal ? Object.values(reveal.results).filter((r) => r.choice === i).length : null;
                    const right = reveal?.correct === i;
                    return (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
                        key={i}
                        className={clsx(
                          'relative flex items-center gap-4 overflow-hidden rounded-3xl border-2 p-5 transition-opacity',
                          reveal && !right && 'opacity-50',
                        )}
                        style={{ borderColor: right ? '#34d399' : `${OPTION_COLORS[i]}66` }}
                      >
                        {picks !== null && playing > 0 && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-y-0 left-0"
                            style={{ background: right ? '#34d39933' : `${OPTION_COLORS[i]}22` }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(picks / playing) * 100}%` }}
                          />
                        )}
                        <span
                          className="relative grid size-12 shrink-0 place-items-center rounded-2xl font-display text-2xl font-black text-ink"
                          style={{ background: right ? '#34d399' : OPTION_COLORS[i] }}
                        >
                          {right ? <Check className="size-7" /> : LETTERS[i]}
                        </span>
                        <span className="relative min-w-0 flex-1 text-[clamp(1.1rem,2vw,1.75rem)] font-semibold">
                          {keepTogether(text)}
                        </span>
                        {picks !== null && (
                          <span className="relative font-display text-3xl font-black tabular-nums">{picks}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-6 text-lg text-fg-2" aria-live="polite">
              {reveal
                ? `${Object.values(reveal.results).filter((r) => r.correct).length} от ${playing} ${
                    q.kind === 'order' ? 'подредиха всичко' : 'познаха'
                  }`
                : `Отговориха ${game.answered.length} от ${playing}`}
            </p>
            {reveal?.fact && (
              <p className="mt-6 max-w-4xl rounded-3xl border border-amber-300/25 bg-amber-400/[0.07] p-5 text-xl text-fg-2 text-pretty">
                <span className="font-bold text-amber-200">💡 Знаеше ли? </span>
                {reveal.fact}
              </p>
            )}
          </section>
          <TopFive game={game} standings={reveal?.standings ?? game.standings} />
        </div>
      ) : (
        <p className="grid flex-1 place-items-center text-2xl text-fg-3">Следващият въпрос идва…</p>
      )}
    </div>
  );
}

/** An order question: its four things while it's open, then the right order with each one's number. */
function OrderOnScreen({ game }: { game: LiveGame }) {
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  const answer = reveal?.answerOrder;
  const rows = answer ? answer.order : q.order!.items.map((_, i) => i);
  return (
    <div className="mt-8">
      <ol className="grid gap-3">
        {rows.map((item, place) => (
          <motion.li
            key={item}
            layout
            className={clsx(
              'flex items-center gap-4 rounded-3xl border-2 p-4',
              answer ? 'border-emerald-400/50' : 'border-line',
            )}
          >
            <span
              className={clsx(
                'grid size-12 shrink-0 place-items-center rounded-2xl font-display text-2xl font-black',
                answer ? 'bg-amber-300 text-amber-950' : 'border-2 border-dashed border-white/25 text-fg-2',
              )}
            >
              {answer ? place + 1 : LETTERS[item]}
            </span>
            <span className="min-w-0 flex-1 text-[clamp(1.1rem,2vw,1.75rem)] font-semibold">
              {keepTogether(q.order!.items[item])}
            </span>
            {answer?.values && (
              <span className="font-display text-2xl font-bold text-amber-200 tabular-nums">
                {orderValueText(answer.values[item], answer.unit)}
              </span>
            )}
          </motion.li>
        ))}
      </ol>
      {!answer && <p className="mt-6 text-2xl text-fg-2">Подредете ги на телефоните си.</p>}
    </div>
  );
}

/** A number question at its reveal: the answer, and who came closest. */
function NumberReveal({ game }: { game: LiveGame }) {
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  if (!reveal || reveal.answerNumber === undefined || !q.number)
    return <p className="mt-8 text-2xl text-fg-2">Въведете числото на телефоните си.</p>;
  const closest = Object.entries(reveal.results)
    .filter(([, r]) => r.number?.guess != null)
    .sort(([, a], [, b]) => (b.number?.closeness ?? 0) - (a.number?.closeness ?? 0))
    .slice(0, 3);
  return (
    <div className="mt-8">
      <p className="font-display text-5xl font-black text-emerald-300 lg:text-6xl">
        {numberText(reveal.answerNumber, q.number)}
      </p>
      {closest.length > 0 && (
        <ol className="mt-6 space-y-2 text-xl">
          {closest.map(([id, r], i) => (
            <li key={id} className="flex items-center gap-3">
              <span className="w-8 font-display font-bold text-fg-3">{i + 1}.</span>
              <span className="font-semibold">{game.players[id]?.name}</span>
              <span className="text-fg-2">{numberText(r.number!.guess!, q.number!)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TopFive({ game, standings }: { game: LiveGame; standings: Standing[] }) {
  return (
    <aside className="glass self-start rounded-3xl p-5">
      <h2 className="t-eyebrow text-fg-3">Класиране</h2>
      <ol className="mt-4 space-y-3">
        {standings.slice(0, 5).map((s) => {
          const p = game.players[s.id];
          return (
            <motion.li layout key={s.id} className="flex items-center gap-3">
              <span className="w-7 font-display text-lg font-bold text-fg-3">{s.rank}</span>
              <Avatar avatar={p.avatar} frame={p.frame} size={40} />
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{p.name}</span>
              <span className="font-display text-xl font-bold tabular-nums">{fmt(s.score)}</span>
            </motion.li>
          );
        })}
      </ol>
    </aside>
  );
}

/** The end: the first three on a podium, then everyone else's place. */
function FinalBoard({ game, standings }: { game: LiveGame; standings: FinalStanding[] }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="mt-8 flex-1">
      <h1 className="text-center font-display text-4xl font-black text-gradient lg:text-6xl">Край!</h1>
      <ol className="mx-auto mt-10 grid max-w-5xl gap-6 md:grid-cols-3">
        {standings.slice(0, 3).map((s, i) => {
          const p = game.players[s.id];
          return (
            <motion.li
              key={s.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + (2 - i) * 0.4 }}
              className="glass flex flex-col items-center gap-3 rounded-3xl p-6 text-center"
            >
              <span className="text-5xl">{medals[i]}</span>
              <Avatar avatar={p.avatar} frame={p.frame} size={88} />
              <span className="font-display text-2xl font-bold [overflow-wrap:anywhere]">{p.name}</span>
              <span className="text-xl text-fg-2 tabular-nums">{fmt(s.score)} т.</span>
            </motion.li>
          );
        })}
      </ol>
      {standings.length > 3 && (
        <ol className="mx-auto mt-8 grid max-w-5xl gap-x-8 gap-y-2 text-lg sm:grid-cols-2 lg:grid-cols-3">
          {standings.slice(3).map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span className="w-14 text-fg-3">{ordinal(s.placement)}</span>
              <span className="min-w-0 flex-1 truncate">{game.players[s.id]?.name}</span>
              <span className="tabular-nums text-fg-2">{fmt(s.score)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
