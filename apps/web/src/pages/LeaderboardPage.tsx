import { api, fmt, pct, useStore } from '@quiz/client';
import { type LeaderboardBoard, type LeaderboardEntry, MODES, titleName } from '@quiz/shared';
import clsx from 'clsx';
import { CalendarDays, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router';
import { Avatar, LevelBadge, RankBadge } from '../components/Avatar';
import { useOpenQueues } from '../components/home/openQueues';
import { LoadError } from '../components/LoadError';
import { Card, EmptyState, Segmented, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';

export function LeaderboardPage() {
  const me = useStore((s) => s.me)!;
  // Boards for the ranked queues that are open; a closed queue's board would only show last season's leftovers.
  const open = useOpenQueues();
  const boards: { value: LeaderboardBoard; label: string }[] = [
    { value: 'level', label: 'Ниво' },
    { value: 'daily', label: 'Днес' },
    ...open.map((m) => ({ value: m, label: MODES[m].name })),
  ];
  const [params, setParams] = useSearchParams();
  const requested = params.get('board') as LeaderboardBoard | null;
  const board: LeaderboardBoard = boards.some((b) => b.value === requested) ? requested! : 'level';
  const setBoard = (b: LeaderboardBoard) => setParams(b === 'level' ? {} : { board: b }, { replace: true });
  const { data, error, retry } = useLoad(() => api.leaderboard(board), board);

  const meInList = data?.entries.some((e) => e.user.id === me.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Класации</h1>
          <p className="mt-1 text-fg-2">
            {board === 'level'
              ? 'Най-опитните играчи по натрупан XP.'
              : board === 'daily'
                ? 'Резултати от днешното предизвикателство. Нулира се в полунощ.'
                : `Рейтинг в класирания режим ${MODES[board].name}.`}
          </p>
          {data?.season && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
              <Trophy className="size-3.5" /> Сезон {data.season.name} · завършва{' '}
              {new Date(data.season.endsAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })}
            </p>
          )}
          {board === 'daily' && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-orange-400/10 px-3 py-1 text-xs font-semibold text-orange-200">
              <CalendarDays className="size-3.5" /> Само по един опит на ден
            </p>
          )}
        </div>
        <Segmented value={board} onChange={setBoard} options={boards} />
      </div>

      {error && !data ? (
        <Card>
          <LoadError title="Класацията не се зареди" error={error} onRetry={retry} />
        </Card>
      ) : !data ? (
        <div className="grid place-items-center py-24">
          <Spinner className="size-8 text-violet-400" />
        </div>
      ) : data.entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={board === 'daily' ? '📅' : '🏁'}
            title={board === 'daily' ? 'Още никой не е играл днес' : 'Още никой не е класиран'}
            body={
              board === 'daily'
                ? 'Изиграй дневното предизвикателство от началната страница.'
                : 'Изиграй класиран мач и оглави тази класация.'
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.entries.slice(0, 3).map((e, i) => (
              <motion.div
                key={e.user.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={clsx(i === 0 && 'sm:order-2', i === 1 && 'sm:order-1', i === 2 && 'sm:order-3')}
              >
                <Link to={`/profile/${encodeURIComponent(e.user.username)}`}>
                  <Card
                    className={clsx(
                      'relative flex flex-col items-center overflow-hidden p-6 text-center transition-colors hover:bg-white/10',
                      i === 0 && 'sm:-mt-4 border-amber-300/40',
                    )}
                  >
                    {i === 0 && <div className="absolute -top-16 size-48 rounded-full bg-amber-400/25 blur-3xl" />}
                    <span className="relative text-3xl">{['🥇', '🥈', '🥉'][i]}</span>
                    <Avatar
                      avatar={e.user.avatar}
                      frame={e.user.frame}
                      size={i === 0 ? 84 : 68}
                      className="relative mt-2"
                    />
                    <div className="relative mt-3 flex items-center gap-1.5 font-semibold">
                      {e.user.username} <LevelBadge level={e.user.level} />
                    </div>
                    <div className="relative text-xs text-fg-3">{titleName(e.user.title)}</div>
                    <div className="relative mt-3">
                      <Value board={board} entry={e} />
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>

          <Card className="divide-y divide-line">
            {data.entries.slice(3).map((e) => (
              <Row key={e.user.id} board={board} entry={e} me={e.user.id === me.id} />
            ))}
            {!meInList && data.me && (
              <>
                <div className="px-5 py-1 text-center text-xs text-fg-3">⋯</div>
                <Row board={board} entry={data.me} me />
              </>
            )}
          </Card>
          {!data.me && board !== 'level' && (
            <p className="text-center text-sm text-fg-3">
              {board === 'daily'
                ? 'Изиграй днешното предизвикателство, за да влезеш в класацията.'
                : 'Изиграй мач в този режим, за да влезеш в класацията.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Row({ board, entry: e, me }: { board: LeaderboardBoard; entry: LeaderboardEntry; me?: boolean }) {
  return (
    <Link
      to={`/profile/${encodeURIComponent(e.user.username)}`}
      className={clsx(
        'flex items-center gap-4 px-5 py-3 transition-colors hover:bg-white/[0.04]',
        me && 'bg-violet-500/10',
      )}
    >
      <span className="w-8 text-right font-bold text-fg-3 tabular-nums">{e.rank}</span>
      <Avatar avatar={e.user.avatar} frame={e.user.frame} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{e.user.username}</span>
          <LevelBadge level={e.user.level} />
        </div>
        <div className="truncate text-xs text-fg-3">{titleName(e.user.title)}</div>
      </div>
      <Value board={board} entry={e} />
    </Link>
  );
}

function Value({ board, entry: e }: { board: LeaderboardBoard; entry: LeaderboardEntry }) {
  if (board === 'level') return <span className="font-semibold tabular-nums">{fmt(e.value)} XP</span>;
  if (board === 'daily') {
    return (
      <div className="flex flex-col items-end">
        <span className="font-semibold tabular-nums">{fmt(e.value)} т.</span>
        {e.correct !== undefined && <span className="text-xs text-fg-3">{e.correct}/10 верни</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <RankBadge rating={e.value} />
      {e.games ? (
        <span className="text-xs text-fg-3">
          {e.wins}/{e.games} победи · {pct(e.wins ?? 0, e.games)}%
        </span>
      ) : null}
    </div>
  );
}
