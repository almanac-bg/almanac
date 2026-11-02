import { type LiveGame, plural } from '@quiz/client';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useState } from 'react';
import { sfx } from '../../lib/sound';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';

/* What happens in a match as it happens: the running feed, a streak, a knockout. */

export function Feed({ game }: { game: LiveGame }) {
  return (
    // On a phone, the right half at most: the category and difficulty chips on the left stay readable.
    <div className="pointer-events-none absolute -top-2 right-0 z-20 flex flex-col items-end gap-1.5 max-sm:max-w-[48%]">
      <AnimatePresence>
        {game.feed.map((f) => (
          <m.span
            key={f.key}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="max-w-full truncate rounded-full border border-amber-300/30 bg-ink-2/95 px-3 py-1 text-xs font-semibold text-amber-200"
          >
            <Emoji e={f.icon} /> {f.text}
          </m.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * People other than you still playing (bots don't count, nor the knocked out or gone). With none, the server doesn't
 * keep anyone waiting for the bots' final: it decides it at once and the results come, so there's nothing to watch.
 */
export function othersStillIn(game: LiveGame) {
  return game.standings.filter(
    (s) => s.id !== game.start.youId && !game.players[s.id]?.isBot && s.eliminatedAt === null && !s.left,
  ).length;
}

/** Streaks worth a moment of their own (the chip in the reveal counts every one). */
const STREAK_MILESTONES = new Set([3, 5, 7, 10, 15, 20]);

/** "🔥 Серия 5!" across the screen at the reveal, gone before an elimination takes the stage (at 0.9 s). */
export function StreakBurst({ game }: { game: LiveGame }) {
  const reveal = game.phase === 'reveal' ? game.reveal : null;
  const mine = reveal?.results[game.start.youId];
  const streak = mine?.correct && STREAK_MILESTONES.has(mine.streak) ? mine.streak : null;
  const quick = !!reveal?.eliminated.length;
  const [shown, setShown] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the reveal; `streak` and `quick` come with it
  useEffect(() => {
    if (streak === null) return setShown(null);
    setShown(streak);
    // After the right answer's own chime.
    const sound = setTimeout(() => sfx.streak(streak), 380);
    const hide = setTimeout(() => setShown(null), quick ? 850 : 1400);
    return () => {
      clearTimeout(hide);
      clearTimeout(sound);
    };
  }, [reveal?.index, streak]);

  return (
    <AnimatePresence>
      {shown !== null && (
        <m.div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-[38%] z-40 flex justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-x-0 top-1/2 h-28 -translate-y-1/2 bg-[linear-gradient(90deg,transparent,rgb(249_115_22/0.35),transparent)] blur-xl" />
          {/* On a solid pill: it lands on the question or the answers, and text over text reads as neither. */}
          <m.p
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 14 }}
            className="relative rounded-full border border-orange-400/50 bg-ink-2/95 px-6 py-3 text-3xl font-black text-orange-200 shadow-[0_0_48px_-6px_rgb(249_115_22/0.75)] sm:px-8 sm:text-4xl"
          >
            <Emoji e="🔥" /> Серия {shown}!
          </m.p>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export function EliminationBanner({ game }: { game: LiveGame }) {
  const ids = game.phase === 'reveal' ? (game.reveal?.eliminated ?? []) : [];
  const [shown, setShown] = useState<string[]>([]);
  const meOut = ids.includes(game.start.youId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids, as `ids` is a new array every render
  useEffect(() => {
    // The reveal is over (the next question is up): whatever was on screen goes with it.
    if (!ids.length) return setShown([]);
    const show = setTimeout(() => setShown(ids), 900);
    // Your own knockout stays a little longer: it's the moment you become a spectator.
    const hide = setTimeout(() => setShown([]), meOut ? 4700 : 3600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [ids.join()]);
  // Who's still in once this reveal is through (the standings already count it).
  const alive = game.standings.filter((s) => s.eliminatedAt === null && !s.left).length;

  return (
    <AnimatePresence>
      {shown.length > 0 && (
        <m.div
          // Darkest behind the message, a light tint elsewhere: the reveal and the scores stay readable through it.
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-[radial-gradient(circle,rgb(76_5_25/0.8)_8rem,rgb(76_5_25/0.15)_24rem)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <KnockoutPlate game={game} ids={shown} alive={alive} />
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** How many of the others a cut shows by face: the rest are counted („и още 9“). */
const FACES = 8;

/**
 * One plate for a cut, however many it takes (the evening Роял cuts a dozen at once, and a plate each stacked up the
 * screen: the review's UX-7): yours big, with the others as a line of small faces; or theirs, the one by name, more as
 * „Отпаднаха 12“. It says once what comes next: the bar along the bottom waits until the plate has gone (GamePage).
 */
function KnockoutPlate({ game, ids, alive }: { game: LiveGame; ids: string[]; alive: number }) {
  const me = ids.includes(game.start.youId);
  const others = ids.filter((id) => id !== game.start.youId).map((id) => game.players[id]);
  const after = `Най-нисък резултат след въпрос ${(game.question?.index ?? 0) + 1}`;
  const faces = (list: typeof others) => (
    <span className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
      {list.slice(0, FACES).map((p) => (
        <Avatar key={p.id} avatar={p.avatar} frame={p.frame} size={32} dim />
      ))}
      {list.length > FACES && <span className="text-sm font-semibold text-fg-2">и още {list.length - FACES}</span>}
    </span>
  );
  const head = me ? 'Отпадна!' : others.length === 1 ? `${others[0].name} отпада!` : `Отпаднаха ${others.length}`;
  return (
    <m.div
      initial={{ scale: 1.6, opacity: 0, rotate: -6 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
      className="flex flex-col items-center text-center"
    >
      {(me || others.length === 1) && (
        <Avatar
          avatar={(me ? game.players[game.start.youId] : others[0]).avatar}
          frame={(me ? game.players[game.start.youId] : others[0]).frame}
          size={110}
          dim
        />
      )}
      {/* On a plate of its own: over the answers, bare text ran into them. */}
      <div className="mx-4 mt-4 max-w-md rounded-3xl border border-rose-400/40 bg-ink-2/95 px-6 py-4 shadow-2xl">
        <p className="text-4xl font-black text-rose-300">{head}</p>
        <p className="mt-1 text-fg-2">{after}</p>
        {!me && others.length > 1 && faces(others)}
        {me && others.length > 0 && (
          <p className="mt-3 text-sm text-fg-2">
            С теб {others.length === 1 ? `отпада и ${others[0].name}` : `отпадат още ${others.length}`}
            {others.length > 1 && faces(others)}
          </p>
        )}
      </div>
      {me && alive > 0 && (
        // Within the screen on a phone (it can take two lines there).
        <p className="mx-4 mt-5 max-w-xs rounded-2xl border border-line bg-ink-2/80 px-4 py-2 text-sm font-semibold text-balance text-fg">
          {othersStillIn(game) === 0 ? (
            'Останаха само ботове — довърши въпросите за XP или виж резултата.'
          ) : (
            <>
              {`${alive === 1 ? 'Остава един' : `Остават ${plural(alive, 'играч', 'играчи')}`} — гледай кой ще спечели`}{' '}
              <Emoji e="👀" />
            </>
          )}
        </p>
      )}
    </m.div>
  );
}
