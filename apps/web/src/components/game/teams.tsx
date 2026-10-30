import { fmt, type LiveGame } from '@quiz/client';
import { type GamePlayer, type Standing, TEAMS, type TeamId, teamPoints } from '@quiz/shared';
import clsx from 'clsx';
import { useCountUp } from '../../lib/hooks';
import { accentText } from './answers';

export const teamColor = (team: TeamId) => TEAMS[team].color;

export const myTeamOf = (game: LiveGame): TeamId | null => game.players[game.start.youId]?.team ?? null;

/** Live team totals, indexed by team: the members' scores summed, as the server counts them (teamPoints). */
export function teamTotals(standings: Standing[], players: Record<string, GamePlayer>): [number, number] {
  return teamPoints(
    standings.flatMap((s) => {
      const team = players[s.id]?.team;
      return team === 0 || team === 1 ? [[team, s.score] as const] : [];
    }),
  );
}

/** "Сините 2 450 ▬▬▬▬▬▬ 1 980 Червените" with your team emphasized. */
export function TeamScoreBar({
  totals,
  myTeam,
  compact,
}: {
  totals: [number, number];
  myTeam: TeamId | null;
  compact?: boolean;
}) {
  const a = useCountUp(totals[0]);
  const b = useCountUp(totals[1]);
  const sum = totals[0] + totals[1];
  const share = sum > 0 ? totals[0] / sum : 0.5;

  const side = (team: TeamId, value: number) => (
    <span
      className={clsx(
        'flex items-center gap-1.5 text-sm tabular-nums',
        team === 1 && 'flex-row-reverse',
        myTeam === team ? 'font-extrabold' : 'font-semibold opacity-75',
      )}
    >
      {!compact && <span style={{ color: accentText(teamColor(team)) }}>{TEAMS[team].name}</span>}
      <span className={clsx(compact ? 'text-sm' : 'font-display text-base')}>{fmt(value)}</span>
    </span>
  );

  return (
    <div
      className="flex min-w-0 items-center gap-2 sm:gap-3"
      role="img"
      aria-label={`${TEAMS[0].name} ${totals[0]} : ${totals[1]} ${TEAMS[1].name}`}
    >
      {side(0, a)}
      <div
        className={clsx(
          'relative h-2 overflow-hidden rounded-full bg-tint/10',
          compact ? 'w-full min-w-16 flex-1' : 'w-28 lg:w-40',
        )}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-l-full transition-[width] duration-700"
          style={{ width: `${share * 100}%`, background: teamColor(0) }}
        />
        <div
          className="absolute inset-y-0 right-0 rounded-r-full transition-[width] duration-700"
          style={{ width: `${(1 - share) * 100}%`, background: teamColor(1) }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${share * 100}% - 1px)` }} />
      </div>
      {side(1, b)}
    </div>
  );
}

export function TeamTotal({ value, className }: { value: number; className?: string }) {
  const shown = useCountUp(value);
  return <span className={clsx('tabular-nums', className)}>{fmt(shown)}</span>;
}
