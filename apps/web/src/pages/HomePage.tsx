import { actions, api, fmt, plural, toast, unlockPreview, useNow, useStore } from '@quiz/client';
import {
  CATEGORIES,
  type CategoryChoice,
  levelProgress,
  MIXED_CATEGORY,
  MODES,
  type ModeDef,
  type QueueModeId,
  RANK_TIERS,
  rankFor,
  SEASON_MIN_GAMES,
  SEASON_REWARD_XP,
  START_RATING,
  STREAK_SHIELDS,
  SUBMISSION_RULES,
  seasonEndsAt,
  seasonKey,
  seasonName,
  TIME_ZONE,
  TITLES,
  type UnlockRef,
  upcomingUnlocks,
} from '@quiz/shared';
import clsx from 'clsx';
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  DoorOpen,
  Flame,
  Gift,
  Lock,
  MailWarning,
  PenLine,
  Plus,
  Share2,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, LevelBadge, RankBadge } from '../components/Avatar';
import { ClaimAccountModal, GuestNudge } from '../components/ClaimAccount';
import { ChallengeCard } from '../components/home/ChallengeCard';
import { useOpenQueues } from '../components/home/openQueues';
import { QuestsCard } from '../components/home/QuestsCard';
import { countdown } from '../components/home/time';
import { LoadError } from '../components/LoadError';
import { Button, buttonClass, Card, Modal, ProgressBar, Spinner } from '../components/ui';
import { accentFill } from '../lib/accent';
import { useLoad } from '../lib/load';
import { useMediaQuery } from '../lib/media';
import { savedDailyShare, shareText } from '../lib/share';
import { usePageTitle } from '../lib/title';

/** Below this the "N играят в момента" count reads as an empty room rather than a busy one, so it stays hidden. */
const LIVE_COUNT_MIN = 5;

/**
 * "предизвикателство" is wider than a small phone's card in the display font, and browsers don't hyphenate Bulgarian:
 * a soft hyphen lets it break where Bulgarian would (and stays invisible when it fits).
 */
const DAILY_TITLE = MODES.daily.name.replace('предизвикателство', 'предизвика\u00ADтелство');

export function HomePage() {
  usePageTitle(null);
  const me = useStore((s) => s.me)!;
  const lobby = useStore((s) => s.lobby);
  const room = useStore((s) => s.room);
  const navigate = useNavigate();
  const [soloOpen, setSoloOpen] = useState(false);
  const [rankInfo, setRankInfo] = useState<{ mode: QueueModeId; open: boolean } | null>(null);
  const level = levelProgress(me.xp).level;
  // Brand-new players get pointed at the gentlest way in (one pointer: two would leave them choosing again).
  const newcomer = level === 1;
  // Writing questions opens at level 3; until then the card would only hold a disabled button.
  const community = level >= SUBMISSION_RULES.minLevel || me.isAdmin;
  // Only the ranked queues the server has open (a closed one would only refuse the player).
  const ranked = useOpenQueues();

  async function queue(mode: QueueModeId) {
    const res = await actions.joinQueue(mode);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  return (
    <div className="space-y-6">
      {room && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate('/room')}
          className="glass focus-ring flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-fuchsia-400/30 px-5 py-3 text-left"
        >
          <DoorOpen className="size-5 text-fuchsia-300" />
          <span className="text-sm">
            Ти си в стая <b className="font-mono tracking-widest">{room.code}</b>
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-300">
            Към стаята <ArrowRight className="size-4" />
          </span>
        </motion.button>
      )}

      <EmailNudge />

      {/* Phones read top to bottom: who you are, what to play, today's daily and quests, then friends and the rest.
          From tablets up (md) the same pieces form a grid with the modes across the middle and "today" under them. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2 md:gap-x-4 md:gap-y-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ProfileCard className="md:col-start-1 md:row-start-1" />

        <section aria-labelledby="modes-title" className="md:col-span-2 md:row-start-2">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h2 id="modes-title" className="t-section">
              Избери битка
            </h2>
            {lobby && lobby.inGame >= LIVE_COUNT_MIN && (
              <span className="text-sm text-fg-3">
                <span className="text-fg-2">{fmt(lobby.inGame)}</span> играят в момента
              </span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ModeCard
              mode={MODES.solo}
              className={clsx(
                'sm:col-span-2',
                ranked.length ? 'lg:col-span-1' : 'lg:col-span-3',
                ranked.length > 1 && 'lg:row-span-2',
              )}
              big
              starter={newcomer}
              onPlay={() => setSoloOpen(true)}
            />
            {ranked.map((id, i) => (
              <ModeCard
                key={id}
                mode={MODES[id]}
                className={queueSpan(i, ranked.length)}
                searching={lobby?.queues[id] ?? 0}
                rating={me.ratings[id] ?? START_RATING}
                onRankInfo={() => setRankInfo({ mode: id, open: true })}
                onPlay={() => queue(id)}
              />
            ))}
          </div>
        </section>

        <DailyCard className="md:col-start-1 md:row-start-3" />
        <QuestsCard className="md:col-start-2 md:row-start-3" />
        <ChallengeCard className={clsx('md:col-start-1 md:row-start-4', !community && 'md:col-span-2')} />
        <FriendsCard className="md:col-start-2 md:row-start-1" />
        {community && <CommunityCard className="md:col-start-2 md:row-start-4" />}
      </div>

      <SoloPicker open={soloOpen} onClose={() => setSoloOpen(false)} />
      {rankInfo && (
        <RankInfo mode={rankInfo.mode} open={rankInfo.open} onClose={() => setRankInfo({ ...rankInfo, open: false })} />
      )}
    </div>
  );
}

/**
 * Grid spans for the i-th of n open ranked modes, so the grid has no holes however many are open.
 * Tablets (2 columns, Соло across the top): they pair up, an odd last one takes a whole row.
 * Desktops (3 columns, Соло down the left): one or two go wide beside it; more pair up, an odd last one wide —
 * with all five, the last runs the full width under Соло.
 */
function queueSpan(i: number, n: number) {
  const last = i === n - 1;
  return clsx(
    n % 2 === 1 && last && 'sm:col-span-2',
    (n <= 2 || (n === 3 && last)) && 'lg:col-span-2',
    n === 5 && last && 'lg:col-span-3',
  );
}

function ProfileCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const progress = levelProgress(me.xp);
  const next = upcomingUnlocks(progress.level, 1)[0];
  const roomy = useMediaQuery('(min-width: 640px)');
  return (
    <Card className={clsx('relative overflow-hidden p-4 sm:p-7', className)}>
      <div className="absolute -top-24 -right-16 size-64 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <Avatar avatar={me.avatar} frame={me.frame} size={roomy ? 84 : 56} />
        <div className="min-w-0">
          <p className="text-sm text-fg-3">Здравей,</p>
          {/* Names run to 20 characters: wrap them (even mid-word) onto a second line rather than cut them off. */}
          {/* Half the width on tablets: a size down there, so a name doesn't break mid-word. */}
          <h1 className="line-clamp-2 font-display text-xl leading-tight font-bold [overflow-wrap:anywhere] sm:text-3xl md:text-2xl lg:text-3xl">
            {me.username}
          </h1>
          <p className="text-sm text-fg-2">{TITLES.find((t) => t.id === me.title)?.name}</p>
        </div>
      </div>
      <div className="relative mt-4 sm:mt-6">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <LevelBadge level={progress.level} /> Ниво {progress.level}
          </span>
          <span className="text-fg-3 tabular-nums">
            {fmt(progress.into)} / {fmt(progress.needed)} XP
          </span>
        </div>
        <ProgressBar value={progress.pct} className="h-2.5" />
      </div>
      {/* Phones keep the daily bonus and the next unlock (what the bar above leads to); the season waits for wider
          screens. */}
      <div
        className={clsx(
          'relative mt-4 flex flex-wrap items-center gap-2 sm:mt-5',
          !me.dailyBonusAvailable && !next && 'max-sm:hidden',
        )}
      >
        {me.dailyBonusAvailable && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">
            <Gift className="size-3.5" /> Днешният бонус +100 XP те чака
          </span>
        )}
        {next && <UpNext unlock={next} />}
        <SeasonChip ratings={me.ratings} className="max-sm:hidden" />
      </div>
      {/* Guests: right under the level it's about — all of this lives on this device until the account is saved. */}
      <GuestNudge className="relative mt-4 sm:mt-5" />
    </Card>
  );
}

function ModeCard({
  mode,
  className,
  big,
  searching,
  rating,
  starter,
  onPlay,
  onRankInfo,
}: {
  mode: ModeDef;
  className?: string;
  big?: boolean;
  searching?: number;
  /** Ranked modes: the player's rating, shown as a rank chip that explains itself. */
  rating?: number;
  starter?: boolean;
  onPlay: () => void;
  onRankInfo?: () => void;
}) {
  const [a, b] = mode.accent;
  return (
    // The whole card plays: the "Играй" button stretches over it (its ::after). The rank chip sits above as its own button.
    // A container: a card that spans more of the grid (however many modes are open) sets itself bigger.
    // The card lifts on hover; the hover is detected on this wrapper, which stays put (a lifted card could otherwise
    // slip out from under a resting pointer and flicker).
    <div className={clsx('group/lift grid', className)}>
      <article
        className={clsx(
          'glass group @container relative isolate flex min-h-44 flex-col overflow-hidden rounded-3xl p-5 transition-[scale,box-shadow,translate] duration-150 sm:min-h-48 sm:p-6',
          'group-hover/lift:-translate-y-1 motion-reduce:group-hover/lift:translate-y-0',
          'has-[[data-play]:active]:scale-[0.98] has-[[data-play]:focus-visible]:shadow-[0_0_0_2px_var(--color-ink),0_0_0_4px_var(--color-cyan)]',
          big && 'lg:min-h-full',
        )}
      >
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-20 transition-opacity duration-300 group-hover:opacity-40"
          style={{
            background: `radial-gradient(120% 90% at 100% 0%, ${a}, transparent 60%), radial-gradient(90% 80% at 0% 100%, ${b}55, transparent 70%)`,
          }}
        />
        {/* How many play: the chip says "1 на 1", "8 играчи"… in words, this says it big. */}
        <span
          aria-hidden
          className={clsx(
            'absolute right-4 -z-10 font-display leading-none font-black text-transparent opacity-60 transition-[rotate,opacity] duration-500 group-hover:-rotate-3 group-hover:opacity-100',
            big ? 'top-4 text-[8rem]' : 'top-3 text-[4.5rem] @lg:top-1 @lg:text-[7rem]',
          )}
          style={{
            WebkitTextStroke: `1.5px ${a}88`,
            backgroundImage: `linear-gradient(160deg, ${a}40, transparent 75%)`,
            WebkitBackgroundClip: 'text',
          }}
        >
          {mode.players}
        </span>

        {/* In a narrow card the chips wrap before they reach the big numeral in the corner. */}
        <div className={clsx('flex flex-wrap items-center gap-2', !big && '@max-sm:pr-16')}>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider uppercase"
            style={accentFill(mode)}
          >
            {mode.short}
          </span>
          {starter && (
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
              Започни оттук
            </span>
          )}
          {rating !== undefined && onRankInfo && (
            <button
              type="button"
              onClick={onRankInfo}
              className="focus-ring relative z-10 -my-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1.5 hover:bg-white/5"
            >
              <span className="text-[11px] font-bold tracking-wider text-fg-2 uppercase">Класиран</span>
              <RankBadge rating={rating} compact />
              <CircleHelp aria-hidden className="size-3.5 text-fg-3" />
              <span className="sr-only">— какво е рангът?</span>
            </button>
          )}
        </div>
        <h3 className={clsx('mt-3 font-display font-bold', big ? 'text-3xl sm:text-4xl' : 'text-2xl @lg:text-4xl')}>
          {mode.name}
        </h3>
        <p className={clsx('mt-1 text-sm text-fg-2', big ? 'max-w-[17rem]' : 'max-w-[17rem] @lg:max-w-md')}>
          {mode.tagline}
        </p>
        <p className={clsx('mt-2 text-sm text-fg-3', big ? 'max-w-xs' : 'max-w-xs @lg:max-w-md')}>{mode.description}</p>
        {/* Desktop: the card is two rows tall, so it lists what you can train in instead of leaving the space empty. */}
        {big && (
          <ul aria-label="Категории" className="mt-6 hidden grid-cols-2 gap-2 lg:grid">
            {CATEGORIES.map((c, i) => (
              <li
                key={c.id}
                className="flex min-w-0 items-center gap-2 rounded-xl border border-line bg-white/5 px-2.5 py-2 text-xs font-semibold text-fg-2 transition-transform duration-300 group-hover:-translate-y-0.5"
                style={{ transitionDelay: `${i * 25}ms` }}
              >
                <span aria-hidden className="text-base leading-none">
                  {c.icon}
                </span>
                <span className="leading-tight">{c.name}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-5 sm:pt-6">
          <span className="text-xs text-fg-3">
            {mode.questions} въпроса · {mode.timeMs / 1000} с
            {searching ? <span className="ml-2 text-emerald-300">● {searching} търсят</span> : null}
          </span>
          {/* Not positioned, so its ::after covers the card rather than the button. */}
          <button
            type="button"
            data-play
            onClick={onPlay}
            className="shrink-0 outline-none after:absolute after:inset-0 after:content-['']"
          >
            {/* A real button's size and shape, in the mode's colours: the main action of the page. */}
            <span
              className={clsx(buttonClass({ variant: 'accent' }), 'group-hover:translate-x-0.5')}
              style={{ ...accentFill(mode), boxShadow: `0 8px 24px -8px ${a}` }}
            >
              Играй <span className="sr-only">{mode.name}</span>
              <ArrowRight aria-hidden className="size-4" />
            </span>
          </button>
        </div>
      </article>
    </div>
  );
}

/** What the "Бронз"/"Сребро"… chip on a ranked mode means. */
function RankInfo({ mode, open, onClose }: { mode: QueueModeId; open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const rating = me.ratings[mode] ?? START_RATING;
  const tier = rankFor(rating);
  return (
    <Modal open={open} onClose={onClose} title="Рейтинг и рангове">
      <div className="space-y-4 text-sm text-fg-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-white/5 p-3.5">
          Твоят рейтинг в „{MODES[mode].name}“: <RankBadge rating={rating} />
        </p>
        <p>
          Всеки класиран режим има свой рейтинг, който започва от {START_RATING}. След мач той расте за всеки съперник,
          когото изпревариш, и пада за всеки, който те изпревари. Срещу по-силни съперници се печели повече.
        </p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {RANK_TIERS.map((t, i) => (
            <li
              key={t.id}
              className={clsx('rounded-xl border px-3 py-2', t.id === tier.id && 'ring-1 ring-white/40')}
              style={{ borderColor: `${t.color}44`, background: `${t.color}10` }}
            >
              <div className="flex items-center gap-1.5 font-bold" style={{ color: t.color }}>
                <span className="size-1.5 rounded-full" style={{ background: t.color }} />
                {t.name}
                {t.id === tier.id && (
                  <span className="ml-auto text-[10px] font-semibold tracking-wide text-fg-2 uppercase">ти</span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-fg-3 tabular-nums">
                {i === 0 ? `под ${RANK_TIERS[1].min}` : `от ${t.min}`} · +{fmt(SEASON_REWARD_XP[t.id])} XP
              </div>
            </li>
          ))}
        </ul>
        <p className="text-fg-3">
          Сезонът трае месец. В края му получаваш XP за най-високия ранг, достигнат в режим с поне {SEASON_MIN_GAMES}{' '}
          мача (наградата за всеки ранг е показана по-горе). В новия сезон рейтингът започва по-близо до {START_RATING}.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Ясно
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/leaderboard?board=${mode}`)}>
          <Trophy className="size-4" /> Класация
        </Button>
      </div>
    </Modal>
  );
}

function FriendsCard({ className }: { className?: string }) {
  const navigate = useNavigate();
  const guest = useStore((s) => !!s.me?.isGuest);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function create() {
    setBusy('create');
    const res = await actions.createRoom();
    setBusy(null);
    if (res.ok) navigate('/room');
    else toast({ kind: 'error', title: res.error });
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 5) return;
    setBusy('join');
    const res = await actions.joinRoom(code);
    setBusy(null);
    if (res.ok) navigate('/room');
    else toast({ kind: 'error', title: res.error });
  }

  return (
    <Card className={clsx('relative overflow-hidden p-5 sm:p-7', className)}>
      <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-fuchsia-600/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-fuchsia-300">
          <Users className="size-5" />
          <span className="t-eyebrow">С приятели</span>
        </div>
        <h2 className="mt-2 t-card">Частна стая</h2>
        <p className="mt-1 text-sm text-fg-3">
          {guest
            ? 'До 8 играчи. Имаш код от приятел? Въведи го и влизаш в стаята.'
            : 'До 8 играчи, твои правила. Сподели кода и започвай.'}
        </p>
        {!guest && (
          <Button variant="secondary" className="mt-5 w-full" onClick={create} loading={busy === 'create'}>
            <Plus className="size-4" /> Създай стая
          </Button>
        )}
        <form onSubmit={join} className={clsx('flex gap-2', guest ? 'mt-5' : 'mt-3')}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            placeholder="Код на стая"
            aria-label="Код на стая"
            className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-black/30 px-4 font-mono text-lg tracking-[0.3em] outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-fg-3 focus:border-fuchsia-400/60"
          />
          <Button type="submit" variant="secondary" disabled={code.length !== 5} loading={busy === 'join'}>
            Влез
          </Button>
        </form>
        {/* Guests can join a room but not open one: the button is still there, and on tap it says why. */}
        {guest && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => setClaiming(true)}>
            <Lock className="size-4" /> Създай своя стая
          </Button>
        )}
      </div>
      {guest && (
        <ClaimAccountModal
          open={claiming}
          onClose={() => setClaiming(false)}
          reason="Свои стаи създават играчите с профил. Избери име и парола — нивото, серията и всичко изиграно досега остават твои."
        />
      )}
    </Card>
  );
}

function UpNext({ unlock }: { unlock: UnlockRef & { level: number } }) {
  const { icon, name } = unlockPreview(unlock);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-fg-2 sm:px-3">
      <span className="shrink-0">Ниво {unlock.level}:</span>
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Without a verified email a forgotten password means a lost account — nudge until one is added. Not before the first
 * match, though (every finished match earns XP): a brand-new player's first screen is for playing.
 */
function EmailNudge() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('quiz:email-nudge') === '1';
    } catch {
      return false;
    }
  });
  // A guest adds an email while saving the account (the profile card asks for that instead).
  if (me.isGuest || me.email || me.pendingEmail || dismissed || me.xp === 0) return null;
  return (
    // Phones: icon, text and close on the first row, the button under the text. Wider: all in one row.
    <div className="glass grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-2xl border-violet-400/30 py-2 pr-1.5 pl-4 sm:flex sm:pl-5">
      <MailWarning aria-hidden className="size-5 shrink-0 text-violet-300" />
      <span className="min-w-0 py-1 text-sm sm:flex-1">
        Добави имейл, за да можеш да възстановиш паролата си, ако я забравиш.
      </span>
      <Button
        variant="secondary"
        className="col-start-2 row-start-2 mb-1.5 justify-self-start sm:mb-0"
        onClick={() => navigate('/settings')}
      >
        Добави имейл
      </Button>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem('quiz:email-nudge', '1');
          } catch {
            /* storage unavailable */
          }
        }}
        aria-label="Скрий"
        title="Скрий"
        className="focus-ring col-start-3 row-start-1 grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function SeasonChip({ ratings, className }: { ratings: Partial<Record<QueueModeId, number>>; className?: string }) {
  const now = useNow(60_000);
  const id = seasonKey(now);
  const days = Math.max(1, Math.ceil((seasonEndsAt(id) - now) / 86_400_000));
  const best = Math.max(START_RATING, ...Object.values(ratings).filter((r): r is number => r !== undefined));
  return (
    <Link
      to="/leaderboard"
      className={clsx(
        'inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-fg-2 hover:bg-white/10',
        className,
      )}
    >
      <Trophy className="size-3.5 text-amber-300" />
      Сезон {seasonName(id)} · още {days} {days === 1 ? 'ден' : 'дни'}
      <RankBadge rating={best} compact />
    </Link>
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
              : 'bg-white/5 text-fg-3 group-hover/shield:bg-white/10',
          )}
        >
          <span aria-hidden>🛡️</span>×{shields}
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

function DailyCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const now = useNow(1000);
  // Reloaded when today's result changes; kept on screen meanwhile.
  const { data: info, error, retry } = useLoad(() => api.daily(), '', `${me.daily.day}:${me.daily.played}`);
  const [busy, setBusy] = useState(false);
  const [a, b] = MODES.daily.accent;
  // Saved by the results screen on this device when today's challenge was played.
  const savedShare = info?.played ? savedDailyShare(me.daily.day) : null;

  // Midnight in Sofia: a new challenge is up.
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
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider text-amber-950 uppercase"
              style={{ background: `linear-gradient(90deg, ${a}, ${b})` }}
            >
              <CalendarDays className="size-3.5" /> Днес · {dayLabel}
            </span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-bold text-orange-300">
                <Flame className="size-3.5" /> {streak} {streak === 1 ? 'ден' : 'дни'} подред
              </span>
            )}
            {/* Last in the row: its explanation opens as a line of its own under the chips. */}
            {(streak > 0 || me.daily.shields > 0) && <StreakShields shields={me.daily.shields} streak={streak} />}
          </div>
          {/* The soft hyphen is for 320 px phones; wider, the long word just goes to the next line. */}
          <h2 className="mt-3 t-card md:[hyphens:none] lg:text-2xl">{DAILY_TITLE}</h2>
          <p className="mt-1 text-sm text-fg-2">{MODES.daily.tagline}</p>

          <div className="mt-auto pt-5">
            {failed ? (
              <LoadError compact title="Днешното предизвикателство не се зареди" error={error} onRetry={retry} />
            ) : !info ? (
              <div aria-hidden className="h-14 w-56 max-w-full animate-pulse rounded-2xl bg-white/8" />
            ) : info.played ? (
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-xs text-fg-3">Твоят резултат</div>
                  <div className="text-2xl font-bold">
                    {fmt(info.played.score)}{' '}
                    {info.played.rank !== null && (
                      <span className="text-base font-semibold text-amber-300">
                        #{info.played.rank} <span className="text-fg-3">от {info.total}</span>
                      </span>
                    )}
                  </div>
                  {info.played.rank === null && (
                    <p className="mt-1 max-w-64 text-xs text-fg-3">
                      Като гост играеш свои въпроси. С профил — общите и класацията.
                    </p>
                  )}
                </div>
                <div className="ml-auto flex gap-2">
                  {savedShare && (
                    <Button variant="secondary" onClick={() => shareText(savedShare)} aria-label="Сподели резултата">
                      <Share2 className="size-4" />
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => navigate('/leaderboard?board=daily')}>
                    Класиране <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : info.attempted ? (
              <p className="text-sm text-fg-3">
                Днешният опит е използван. Ново предизвикателство след {countdown(info.endsAt - now)}.
              </p>
            ) : (
              <Button variant="gold" size="lg" onClick={play} loading={busy}>
                Играй днешното <ArrowRight className="size-5" />
              </Button>
            )}
            {info && !failed && !info.attempted && (
              <p className="mt-3 text-xs text-fg-3 tabular-nums">Изтича след {countdown(info.endsAt - now)}</p>
            )}
            {info && !failed && info.played && (
              <p className="mt-3 text-xs text-fg-3 tabular-nums">Ново след {countdown(info.endsAt - now)}</p>
            )}
          </div>
        </div>

        {!failed && (
          <div className="rounded-2xl border border-line bg-black/20 p-4">
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
                    <span className="w-5 text-center">{['🥇', '🥈', '🥉'][e.rank - 1]}</span>
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

function CommunityCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [todo, setTodo] = useState<{ pendingQuestions: number; openReports: number; questionReports: number } | null>(
    null,
  );
  const locked = levelProgress(me.xp).level < SUBMISSION_RULES.minLevel;
  const pending = todo ? todo.pendingQuestions + todo.openReports + todo.questionReports : 0;
  // Open the moderation tab that has work waiting.
  const adminTab =
    !todo || todo.pendingQuestions
      ? '/admin'
      : todo.questionReports
        ? '/admin?tab=flags'
        : todo.openReports
          ? '/admin?tab=reports'
          : '/admin';

  useEffect(() => {
    if (me.isAdmin)
      api
        .adminSummary()
        .then(setTodo)
        .catch(() => {});
  }, [me.isAdmin]);

  return (
    <Card className={clsx('relative flex flex-col overflow-hidden p-5 sm:p-7', className)}>
      <div className="absolute -right-10 -bottom-16 size-48 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="relative flex items-center gap-2 text-emerald-300">
        <PenLine className="size-5" />
        <span className="t-eyebrow">Общност</span>
      </div>
      <h2 className="relative mt-2 t-card">Предложи въпрос</h2>
      <p className="relative mt-1 text-sm text-fg-3">
        Знаеш нещо интересно? Изпрати въпрос — одобрените влизат в играта с твоето име и +{SUBMISSION_RULES.approvedXp}{' '}
        XP.
      </p>
      <div className="relative mt-auto flex flex-wrap gap-2 pt-5">
        {/* Only admins see the card before level 3 (for moderation); writing still waits for the level. */}
        {!locked && (
          <Button variant="secondary" onClick={() => navigate('/submit')}>
            <PenLine className="size-4" /> Напиши въпрос
          </Button>
        )}
        {me.isAdmin && (
          <Button variant="ghost" onClick={() => navigate(adminTab)}>
            <ShieldCheck className="size-4" /> Модерация
            {pending ? (
              <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{pending}</span>
            ) : null}
          </Button>
        )}
      </div>
    </Card>
  );
}

function SoloPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState<CategoryChoice | null>(null);

  async function start(category: CategoryChoice) {
    setBusy(category);
    const res = await actions.startSolo(category);
    setBusy(null);
    if (res.ok) onClose();
    else toast({ kind: 'error', title: res.error });
  }

  const options = [MIXED_CATEGORY, ...CATEGORIES];
  return (
    <Modal open={open} onClose={onClose} title="Избери категория" className="max-w-2xl">
      {/* As many columns as fit tiles wide enough for „Изкуство и литература“: one on a 320 px phone, two at 375,
          three in a wider dialog. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5">
        {options.map((c, i) => (
          <motion.button
            key={c.id}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025 }}
            disabled={busy !== null}
            onClick={() => start(c.id as CategoryChoice)}
            className={clsx(
              'focus-ring group relative flex items-center gap-2.5 overflow-hidden rounded-2xl border border-line bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.07] disabled:opacity-60 sm:gap-3 sm:p-3.5',
              c.id === 'mixed' && 'col-span-full',
            )}
          >
            <span
              className="absolute inset-y-0 left-0 w-1 opacity-70 transition-all group-hover:w-1.5"
              style={{ background: c.color }}
            />
            <span className="text-xl sm:text-2xl">{c.icon}</span>
            <span className="min-w-0 text-sm font-semibold break-words">{c.name}</span>
            {c.id === 'mixed' && <span className="ml-auto text-xs text-fg-3">по малко от всичко</span>}
          </motion.button>
        ))}
      </div>
    </Modal>
  );
}
