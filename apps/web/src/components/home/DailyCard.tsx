import { actions, api, fmt, plural, toast, useNow, useStore } from '@quiz/client';
import {
  BRAND,
  type DailyInfo,
  dayKey,
  dayNumber,
  dayTheme,
  type LeaderboardEntry,
  MODES,
  STREAK_SHIELDS,
  TIME_ZONE,
} from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, CalendarDays, ChevronDown, Flame, Share2, Users } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { dailyLinkUrl, offBoardLine, placeShown } from '../../lib/daily';
import { useLoad } from '../../lib/load';
import { savedDailyShare, shareText } from '../../lib/share';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { GroupStandings } from '../groups';
import { LoadError } from '../LoadError';
import { Button, Card, Spinner } from '../ui';
import { countdown } from './time';

export function DailyCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const now = useNow(1000);
  // Reloaded when today's result changes; kept on screen meanwhile.
  const { data: info, error, retry } = useLoad(() => api.daily(), '', `${me.daily.day}:${me.daily.played}`);
  const [busy, setBusy] = useState(false);
  const [a, b] = MODES.daily.accent;
  // Saved by the results screen on this device when today's questions were played (with the squares).
  const savedShare = info?.played ? savedDailyShare(me.daily.day) : null;
  const madeToday = dayKey(me.createdAt) === me.daily.day;

  // Played on another device: the link and the score, without the squares.
  async function share() {
    if (savedShare) return shareText(savedShare, 'Линкът и резултатът са копирани');
    if (!info?.played) return;
    const link = await dailyLinkUrl();
    const of = MODES.daily.questions;
    shareText(
      `${BRAND.mark} ${BRAND.name} №${info.number} · ${info.played.correct}/${of}\n${fmt(info.played.score)} т.\n${link}`,
      'Линкът и резултатът са копирани',
    );
  }

  // Midnight in Sofia: new questions are up.
  const expired = !!info && now >= info.endsAt;
  useEffect(() => {
    if (expired) retry();
  }, [expired, retry]);
  // Without today's info there's nothing true to show: not "play", not "nobody played yet".
  const failed = !!error && (!info || expired);

  async function play() {
    setBusy(true);
    const res = await actions.startDaily();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  const theme = dayTheme(info?.day ?? me.daily.day);
  const dayLabel = new Date(`${info?.day ?? me.daily.day}T12:00:00Z`).toLocaleDateString('bg-BG', {
    day: 'numeric',
    month: 'long',
    timeZone: TIME_ZONE,
  });
  const streak = info?.streak ?? me.daily.streak;

  return (
    // Sized by its own width: the day's top three go beside the button only where the title still fits next to them.
    <Card className={clsx('@container relative overflow-hidden p-5 sm:p-7', className)}>
      <div
        className="absolute inset-0 opacity-25"
        style={{
          background: `radial-gradient(100% 120% at 100% 0%, ${a}, transparent 55%), radial-gradient(80% 90% at 0% 100%, ${b}55, transparent 70%)`,
        }}
      />
      <div
        className={clsx(
          'relative grid h-full gap-5 @2xl:gap-6',
          !failed && '@2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]',
        )}
      >
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-wider text-[#451a03] uppercase"
              style={{ background: `linear-gradient(90deg, ${a}, ${b})` }}
            >
              <CalendarDays className="size-3.5" /> №{info?.number ?? dayNumber(me.daily.day)} · {dayLabel}
            </span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-bold text-orange-300">
                <Flame className="size-3.5" /> {streak} {streak === 1 ? 'ден' : 'дни'} подред
              </span>
            )}
            {/* Last in the row: its explanation opens as a line of its own under the chips. */}
            {(streak > 0 || me.daily.shields > 0) && <StreakShields shields={me.daily.shields} streak={streak} />}
          </div>
          <h2 className="mt-3 t-card lg:text-2xl">{MODES.daily.name}</h2>
          <p className="mt-1 text-sm text-fg-2">{MODES.daily.tagline}</p>
          {theme && (
            <p className="mt-1 text-sm font-semibold text-amber-300">
              Темата днес:{' '}
              <Link
                to={theme.page}
                className="underline decoration-amber-300/50 underline-offset-2 hover:decoration-amber-300"
              >
                {theme.name}
              </Link>
            </p>
          )}

          <div className="mt-auto pt-5">
            {failed ? (
              <LoadError compact title="Въпросите на деня не се заредиха" error={error} onRetry={retry} />
            ) : !info ? (
              <div aria-hidden className="h-14 w-56 max-w-full animate-pulse rounded-2xl bg-tint/8" />
            ) : info.played ? (
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-xs text-fg-3">Твоят резултат</div>
                  <div className="text-2xl font-bold">
                    {fmt(info.played.score)}{' '}
                    {!info.offBoard && placeShown(info.total) && (
                      <span className="text-base font-semibold text-amber-300">
                        #{info.played.rank} <span className="text-fg-3">от {info.total}</span>
                      </span>
                    )}
                  </div>
                  {info.offBoard && (
                    <p className="mt-1 max-w-64 text-xs text-fg-3">
                      {offBoardLine({ guest: me.isGuest, madeToday, rank: info.played.rank, total: info.total })}
                    </p>
                  )}
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" onClick={() => void share()} aria-label="Прати днешните въпроси">
                    <Share2 className="size-4" />
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/leaderboard?board=daily')}>
                    Класация <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : info.attempted ? (
              <p className="text-sm text-fg-3">
                Днешният опит е използван. Нови въпроси след {countdown(info.endsAt - now)}.
              </p>
            ) : (
              <Button variant="gold" size="lg" onClick={play} loading={busy}>
                Играй днешните <ArrowRight className="size-5" />
              </Button>
            )}
            {info && !failed && <AmongFriends friends={info.friends} meId={me.id} />}
            <GroupStandings refresh={`${me.daily.day}:${me.daily.played}`} />
            {info && !failed && info.fromMyLink.length > 0 && <FromMyLink plays={info.fromMyLink} />}
            {info && !failed && !info.attempted && (
              <p className="mt-3 text-xs text-fg-3 tabular-nums">Изтича след {countdown(info.endsAt - now)}</p>
            )}
            {info && !failed && info.played && (
              <p className="mt-3 text-xs text-fg-3 tabular-nums">Ново след {countdown(info.endsAt - now)}</p>
            )}
          </div>
        </div>

        {!failed && (
          <div className="rounded-2xl border border-line bg-sunk/20 p-4">
            <p className="mb-3 t-eyebrow text-fg-3">Топ на деня</p>
            {!info ? (
              <div className="grid place-items-center py-4">
                <Spinner className="size-5 text-amber-300" />
                <span className="sr-only">Зареждане…</span>
              </div>
            ) : info.entries.length > 0 ? (
              <ol className="space-y-2">
                {info.entries.slice(0, 3).map((e) => (
                  <li key={e.user.id} className="flex items-center gap-2.5 text-sm">
                    <Emoji e={['🥇', '🥈', '🥉'][e.rank - 1]} className="size-5" size="" />
                    <Avatar avatar={e.user.avatar} frame={e.user.frame} size={30} />
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate font-semibold',
                        e.user.id === me.id && 'text-violet-300',
                      )}
                    >
                      {e.user.username}
                    </span>
                    <span className="text-fg-2 tabular-nums">{fmt(e.value)}</span>
                  </li>
                ))}
              </ol>
            ) : info.offBoard ? (
              // Off the board today: "start the board" isn't theirs to do.
              <p className="py-4 text-center text-sm text-fg-3">Днес още никой не е в класацията.</p>
            ) : (
              <p className="py-4 text-center text-sm text-fg-3">Още никой не е играл днес. Започни класацията!</p>
            )}
            {info && info.total > 3 && (
              <p className="mt-3 text-xs text-fg-3">+ още {plural(info.total - 3, 'играч', 'играчи')} днес</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * The streak's shields, as a chip that explains itself on tap — a hover title alone would leave touch screens guessing.
 * The explanation is a full-width line of the chip row it sits in.
 */
function StreakShields({ shields, streak }: { shields: number; streak: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toNext = STREAK_SHIELDS.every - (streak % STREAK_SHIELDS.every);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={id}
        title="Щитове за серията"
        className="focus-ring group/shield -my-2.5 inline-flex min-h-11 items-center rounded-full"
      >
        <span
          className={clsx(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold transition-colors',
            shields
              ? 'bg-sky-400/15 text-sky-200 group-hover/shield:bg-sky-400/25'
              : 'bg-tint/5 text-fg-3 group-hover/shield:bg-tint/10',
          )}
        >
          <span aria-hidden>
            <Emoji e="🛡️" />
          </span>
          ×{shields}
          <span className="sr-only">{shields === 1 ? ' щит' : ' щита'} за серията — какво е това?</span>
          <ChevronDown aria-hidden className={clsx('size-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      <p
        id={id}
        hidden={!open}
        className="basis-full rounded-2xl border border-sky-300/20 bg-sky-400/10 px-3.5 py-2.5 text-xs text-sky-100"
      >
        Щитът пази серията: ако пропуснеш ден, един щит се изразходва и серията продължава. Получаваш по един на всеки{' '}
        {STREAK_SHIELDS.every} поредни дни (най-много {STREAK_SHIELDS.max}).{' '}
        <span className="text-sky-200/80">
          {shields >= STREAK_SHIELDS.max ? 'Имаш максимума.' : `До следващия: ${plural(toNext, 'ден', 'дни')}.`}
        </span>
      </p>
    </>
  );
}

/** Who played today's questions from your link: how many, and who leads. */
function FromMyLink({ plays }: { plays: DailyInfo['fromMyLink'] }) {
  const lead = plays[0];
  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-fg-2">
      <Share2 aria-hidden className="size-4 shrink-0 text-amber-300" />
      <span className="min-w-0">
        По твоя линк: {plural(plays.length, 'човек', 'души')} · води {lead.user.username} ({lead.correct}/
        {MODES.daily.questions})
      </span>
    </p>
  );
}

/** The day among friends, in a line: who just passed you, that you lead, or who leads while you haven't played. */
function AmongFriends({ friends, meId }: { friends: LeaderboardEntry[]; meId: number }) {
  const mine = friends.find((e) => e.user.id === meId);
  const others = friends.filter((e) => e.user.id !== meId);
  if (!others.length) return null;
  const ahead = mine && mine.rank > 1 ? friends[mine.rank - 2] : null;
  const line = ahead
    ? `${ahead.user.username} те изпревари днес · ${fmt(ahead.value)} т.`
    : mine
      ? 'Водиш сред приятелите си днес'
      : `${others[0].user.username} води сред приятелите ти · ${fmt(others[0].value)} т.`;
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm text-fg-2">
      <Users aria-hidden className="size-4 shrink-0 text-amber-300" />
      <span className="min-w-0">{line}</span>
    </p>
  );
}
