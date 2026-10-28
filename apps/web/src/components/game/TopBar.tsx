import { fmt, type LiveGame } from '@quiz/client';
import { MODES } from '@quiz/shared';
import clsx from 'clsx';
import { Flame, Skull, Volume2, VolumeX, X } from 'lucide-react';
import { motion } from 'motion/react';
import { accentFill } from '../../lib/accent';
import { useCountUp } from '../../lib/hooks';
import { useMuted } from '../../lib/sound';
import { nextElimination } from './elimination';
import { myTeamOf, TeamScoreBar, teamTotals } from './teams';

/** The match screen's top bar: the mode, how far along it is, your score, the sound and the way out. */
export function TopBar({ game, onLeave }: { game: LiveGame; onLeave: () => void }) {
  const mode = MODES[game.start.mode];
  const me = game.standings.find((s) => s.id === game.start.youId);
  const score = useCountUp(me?.score ?? 0);
  const q = game.question;
  // Phones have no room for the dots that mark the knockouts: the next one, in a word.
  const knockout = me && me.eliminatedAt === null && !me.left ? nextElimination(game) : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6 flat:h-12">
        <button
          type="button"
          onClick={onLeave}
          aria-label="Напусни мача"
          className="focus-ring -ml-2 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
        >
          <X className="size-5" />
        </button>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider whitespace-nowrap uppercase"
          style={accentFill(mode)}
        >
          {game.start.mode === 'daily' ? 'Днес' : game.start.duelWith ? 'Дуел' : mode.name}
        </span>
        {game.start.teams ? (
          <div className="mx-auto hidden sm:block">
            <TeamScoreBar totals={teamTotals(game.standings, game.players)} myTeam={myTeamOf(game)} />
          </div>
        ) : (
          q && (
            // Decorative: the counter next to it says the same in words.
            <div className="hidden items-center gap-1 sm:flex" aria-hidden>
              {Array.from({ length: q.total }, (_, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: one dot per question number
                  key={i}
                  className={clsx(
                    'h-1.5 rounded-full transition-all',
                    i < q.index ? 'w-3 bg-violet-400/70' : i === q.index ? 'w-6 bg-white' : 'w-3 bg-white/15',
                    game.start.eliminationSchedule.includes(i + 1) && i >= q.index && 'bg-rose-400/50',
                  )}
                />
              ))}
            </div>
          )
        )}
        {q && (
          <span className="text-sm font-semibold text-fg-2 tabular-nums">
            <span aria-hidden>
              {q.index + 1}/{q.total}
            </span>
            <span className="sr-only">
              Въпрос {q.index + 1} от {q.total}
            </span>
          </span>
        )}
        {knockout !== null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-300 tabular-nums sm:hidden">
            <Skull aria-hidden className="size-3.5" />
            <span aria-hidden>{knockout}</span>
            <span className="sr-only">Следващото отпадане е след въпрос {knockout}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {me && me.streak >= 2 && (
            <motion.span
              key={me.streak}
              initial={{ scale: 1.4 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300"
            >
              <Flame className="size-4" /> {me.streak}
            </motion.span>
          )}
          <span className="font-display text-xl font-bold tabular-nums">
            <span aria-hidden>{fmt(score)}</span>
            <span className="sr-only">{fmt(me?.score ?? 0)} точки</span>
          </span>
          <MuteButton />
        </div>
      </div>
    </header>
  );
}

function MuteButton() {
  const [muted, setMuted] = useMuted();
  const label = muted ? 'Включи звука' : 'Изключи звука';
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-label={label}
      title={label}
      className="focus-ring -mr-2 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
    >
      {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
    </button>
  );
}
