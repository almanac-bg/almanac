import { api, fmt, pct, useStore } from '@quiz/client';
import { BRAND, dayKey, type LeaderboardBoard, type LeaderboardEntry, MODES, titleName } from '@quiz/shared';
import clsx from 'clsx';
import { CalendarDays, Share2, Trophy, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar, LevelBadge, RankBadge } from '../components/Avatar';
import { Emoji } from '../components/Emoji';
import { PlayerName } from '../components/FitName';
import { useOpenQueues } from '../components/home/openQueues';
import { LoadError } from '../components/LoadError';
import { Button, buttonClass, Card, EmptyState, Segmented, Spinner } from '../components/ui';
import { useLoad } from '../lib/load';
import { useMediaQuery } from '../lib/media';
import { shareText } from '../lib/share';
import { usePageTitle } from '../lib/title';

/** Guests play everything but aren't on the boards: what puts them there. */
const GUEST_LINE = 'Класациите са за играчи с профил: запази прогреса си, за да влезеш в тях.';

export function LeaderboardPage() {
  usePageTitle('Класации');
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
  const roomy = useMediaQuery('(min-width: 640px)');

  // The daily board, among friends: the same day, just you and the people you know (you're in that list yourself).
  const [scope, setScope] = useState<'all' | 'friends'>('all');
  const amongFriends = board === 'daily' && scope === 'friends';
  // A new account plays the day's questions off the board: having just played, it isn't missing from it by mistake.
  const dailyLine =
    me.daily.played && dayKey(me.createdAt) === me.daily.day
      ? 'Днешният ти резултат е само за теб: новият ти профил влиза в класацията от утре.'
      : 'Изиграй въпросите на деня, за да влезеш в класацията. Отворена е до полунощ.';
  const entries = (amongFriends ? data?.friends : data?.entries) ?? [];
  const meEntry = amongFriends ? null : (data?.me ?? null);
  const meInList = entries.some((e) => e.user.id === me.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-page">Класации</h1>
          <p className="mt-1 text-fg-2">
            {board === 'level'
              ? 'Най-опитните играчи по натрупан XP.'
              : board === 'daily'
                ? 'Резултатите от въпросите на деня. Нулира се в полунощ.'
                : `Рейтинг в класирания режим „${MODES[board].name}“.`}
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

      {board === 'daily' && !me.isGuest && (
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Цяла България' },
            { value: 'friends', label: 'Приятели' },
          ]}
        />
      )}

      {error && !data ? (
        <Card>
          <LoadError title="Класацията не се зареди" error={error} onRetry={retry} />
        </Card>
      ) : !data ? (
        <div className="grid place-items-center py-24">
          <Spinner className="size-8 text-violet-400" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={board === 'daily' ? '🗓️' : '🏁'}
            title={
              amongFriends
                ? 'Никой от приятелите ти не е играл днес'
                : board === 'daily'
                  ? 'Още никой не е в днешната класация'
                  : 'Още никой не е класиран'
            }
            body={
              me.isGuest ? GUEST_LINE : board === 'daily' ? dailyLine : 'Изиграй класиран мач и оглави тази класация.'
            }
          />
        </Card>
      ) : (
        <>
          {/* A podium on every screen: on phones three narrow columns (full-width cards pushed the list, and "you", three
              screens down), first place in the middle and raised. */}
          <ol className="grid grid-cols-3 items-end gap-2 sm:gap-3">
            {entries.slice(0, 3).map((e, i) => (
              <motion.li
                key={e.user.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                className={clsx('row-start-1 min-w-0', ['col-start-2', 'col-start-1', 'col-start-3'][i])}
              >
                <Link to={`/profile/${encodeURIComponent(e.user.username)}`} className="focus-ring block rounded-3xl">
                  <Card
                    className={clsx(
                      'relative flex flex-col items-center overflow-hidden px-2 py-4 text-center transition-colors hover:bg-tint/10 sm:p-6',
                      i === 0 && 'border-amber-300/40 pt-6 sm:pt-8',
                    )}
                  >
                    {i === 0 && <div className="absolute -top-16 size-48 rounded-full glow text-amber-400/25" />}
                    <Emoji e={['🥇', '🥈', '🥉'][i]} className="relative size-7 sm:size-9" size="" />
                    <Avatar
                      avatar={e.user.avatar}
                      frame={e.user.frame}
                      size={roomy ? (i === 0 ? 84 : 68) : i === 0 ? 56 : 48}
                      className="relative mt-2"
                    />
                    <div className="relative mt-2 flex max-w-full items-center gap-1.5 text-sm font-semibold sm:mt-3 sm:text-base">
                      <PlayerName name={e.user.username} />
                      <LevelBadge level={e.user.level} className="shrink-0 max-sm:hidden" />
                    </div>
                    <div className="relative max-w-full truncate text-xs text-fg-3 max-sm:hidden">
                      {titleName(e.user.title)}
                    </div>
                    <div className="relative mt-2 max-w-full sm:mt-3">
                      <Value board={board} entry={e} podium />
                    </div>
                  </Card>
                </Link>
              </motion.li>
            ))}
          </ol>

          {/* Not with three players or fewer: it would be an empty strip under the podium. */}
          {(entries.length > 3 || (!meInList && meEntry)) && (
            <Card className="divide-y divide-line">
              {entries.slice(3).map((e) => (
                <Row key={e.user.id} board={board} entry={e} me={e.user.id === me.id} />
              ))}
              {!meInList && meEntry && (
                <>
                  <div className="px-5 py-1 text-center text-xs text-fg-3">⋯</div>
                  <Row board={board} entry={meEntry} me />
                </>
              )}
            </Card>
          )}
          {!meEntry && !amongFriends && board !== 'level' && (
            <p className="text-center text-sm text-fg-3">
              {me.isGuest
                ? GUEST_LINE
                : board === 'daily'
                  ? dailyLine
                  : 'Изиграй мач в този режим, за да влезеш в класацията.'}
            </p>
          )}
          {entries.length <= 3 && <BringFriends />}
        </>
      )}
    </div>
  );
}

/** A board of three ends at the podium: the next step is more people on it. */
function BringFriends() {
  return (
    <Card className="flex flex-col items-center gap-4 p-6 text-center sm:p-8">
      <div>
        <p className="font-extrabold">Класацията тепърва се пълни</p>
        <p className="mt-1 text-sm text-fg-2">
          Доведи приятели — тук ще ги виждаш до себе си, а в дуел ще разберете кой знае повече.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          onClick={() =>
            shareText(
              `Ела да се мерим в ${BRAND.name} — безплатна онлайн викторина, 10 въпроса на деня за цяла България: ${window.location.origin}`,
              'Линкът е копиран',
            )
          }
        >
          <Share2 aria-hidden className="size-4" /> Покани приятели
        </Button>
        <Link to="/friends" className={buttonClass({ variant: 'secondary' })}>
          <Users aria-hidden className="size-4" /> Приятели
        </Link>
      </div>
    </Card>
  );
}

function Row({ board, entry: e, me }: { board: LeaderboardBoard; entry: LeaderboardEntry; me?: boolean }) {
  return (
    <Link
      to={`/profile/${encodeURIComponent(e.user.username)}`}
      className={clsx(
        'flex items-center gap-4 px-5 py-3 transition-colors hover:bg-tint/[0.04]',
        me && 'bg-violet-500/10',
      )}
    >
      <span className="w-8 text-right font-bold text-fg-3 tabular-nums">{e.rank}</span>
      <Avatar avatar={e.user.avatar} frame={e.user.frame} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <PlayerName name={e.user.username} />
          <LevelBadge level={e.user.level} />
        </div>
        <div className="truncate text-xs text-fg-3">{titleName(e.user.title)}</div>
      </div>
      <Value board={board} entry={e} />
    </Link>
  );
}

/** The score on a row (right-aligned), or on a podium card (centred, and on phones in a column under 100px wide). */
function Value({ board, entry: e, podium }: { board: LeaderboardBoard; entry: LeaderboardEntry; podium?: boolean }) {
  const align = podium ? 'items-center' : 'items-end';
  if (board === 'level') {
    return <span className="font-semibold whitespace-nowrap tabular-nums max-sm:text-sm">{fmt(e.value)} XP</span>;
  }
  if (board === 'daily') {
    return (
      <div className={clsx('flex flex-col', align)}>
        <span className="font-semibold whitespace-nowrap tabular-nums max-sm:text-sm">{fmt(e.value)} т.</span>
        {e.correct !== undefined && <span className="text-xs text-fg-3">{e.correct}/10 верни</span>}
      </div>
    );
  }
  return (
    <div className={clsx('flex flex-col gap-1', align)}>
      {podium ? (
        // The rating under the rank, not beside it: side by side they're wider than a phone's podium column.
        <>
          <RankBadge rating={e.value} compact />
          <span className="text-sm font-semibold tabular-nums">{e.value}</span>
        </>
      ) : (
        <RankBadge rating={e.value} />
      )}
      {e.games ? (
        <span className={clsx('text-xs text-fg-3', podium && 'max-sm:hidden')}>
          {e.wins}/{e.games} победи · {pct(e.wins ?? 0, e.games)}%
        </span>
      ) : null}
    </div>
  );
}
