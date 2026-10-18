import {
  CATEGORIES,
  type CategoryChoice,
  type DailyInfo,
  levelProgress,
  MIXED_CATEGORY,
  type ModeDef,
  MODES,
  QUEUE_MODES,
  type QueueModeId,
  seasonEndsAt,
  seasonKey,
  seasonName,
  START_RATING,
  SUBMISSION_RULES,
  TIME_ZONE,
  TITLES,
  upcomingUnlocks,
} from '@quiz/shared';
import clsx from 'clsx';
import {
  ArrowRight,
  CalendarDays,
  DoorOpen,
  Flame,
  Gift,
  Lock,
  MailWarning,
  PenLine,
  Plus,
  ShieldCheck,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, LevelBadge, RankBadge } from '../components/Avatar';
import { Button, Card, Modal, ProgressBar } from '../components/ui';
import { api } from '../lib/api';
import { fmt } from '../lib/format';
import { useNow } from '../lib/hooks';
import { actions } from '../lib/socket';
import { toast, useStore } from '../lib/store';
import { unlockPreview } from '../lib/unlocks';

export function HomePage() {
  const me = useStore((s) => s.me)!;
  const lobby = useStore((s) => s.lobby);
  const room = useStore((s) => s.room);
  const navigate = useNavigate();
  const [soloOpen, setSoloOpen] = useState(false);
  const progress = levelProgress(me.xp);

  async function queue(mode: QueueModeId) {
    const res = await actions.joinQueue(mode);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  return (
    <div className="space-y-8">
      {room && (
        <motion.button
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate('/room')}
          className="glass focus-ring flex w-full items-center gap-3 rounded-2xl border-fuchsia-400/30 px-5 py-3 text-left"
        >
          <DoorOpen className="size-5 text-fuchsia-300" />
          <span className="text-sm">
            В стая <b className="font-mono tracking-widest">{room.code}</b> си
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-300">
            Към стаята <ArrowRight className="size-4" />
          </span>
        </motion.button>
      )}

      <EmailNudge />

      {/* Hero */}
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="relative overflow-hidden p-6 sm:p-7">
          <div className="absolute -top-24 -right-16 size-64 rounded-full bg-violet-600/30 blur-3xl" />
          <div className="relative flex items-center gap-5">
            <Avatar avatar={me.avatar} frame={me.frame} size={84} />
            <div className="min-w-0">
              <p className="text-sm text-fg-3">Здравей,</p>
              <h1 className="truncate font-display text-2xl font-bold sm:text-3xl">{me.username}</h1>
              <p className="text-sm text-fg-2">{TITLES.find((t) => t.id === me.title)?.name}</p>
            </div>
          </div>
          <div className="relative mt-6">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-semibold">
                <LevelBadge level={progress.level} /> Ниво {progress.level}
              </span>
              <span className="text-fg-3 tabular-nums">
                {fmt(progress.into)} / {fmt(progress.needed)} XP
              </span>
            </div>
            <ProgressBar value={progress.pct} className="h-2.5" />
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-2">
            {me.dailyBonusAvailable && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">
                <Gift className="size-3.5" /> Днешният бонус +100 XP те чака
              </span>
            )}
            <UpNext level={progress.level} />
            <SeasonChip ratings={me.ratings} />
          </div>
        </Card>

        <FriendsCard />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <DailyCard />
        <CommunityCard />
      </section>

      {/* Modes */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-bold sm:text-2xl">Избери битка</h2>
          {lobby && (
            <span className="text-sm text-fg-3">
              <span className="text-fg-2">{fmt(lobby.inGame)}</span> играят в момента
            </span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ModeCard mode={MODES.solo} className="sm:col-span-2 lg:col-span-1 lg:row-span-2" big onPlay={() => setSoloOpen(true)} />
          {QUEUE_MODES.map((id) => (
            <ModeCard
              key={id}
              mode={MODES[id]}
              className={clsx(id === 'royale' && 'sm:col-span-2 lg:col-span-3')}
              wide={id === 'royale'}
              searching={lobby?.queues[id] ?? 0}
              rating={me.ratings[id] ?? START_RATING}
              onPlay={() => queue(id)}
            />
          ))}
        </div>
      </section>

      <SoloPicker open={soloOpen} onClose={() => setSoloOpen(false)} />
    </div>
  );
}

const BIG_LABEL: Record<string, string> = { solo: '1', duel: '1v1', teams: '2v2', trio: '3', squad: '5', royale: '8' };

function ModeCard({
  mode,
  className,
  big,
  wide,
  searching,
  rating,
  onPlay,
}: {
  mode: ModeDef;
  className?: string;
  big?: boolean;
  wide?: boolean;
  searching?: number;
  rating?: number;
  onPlay: () => void;
}) {
  const [a, b] = mode.accent;
  return (
    <motion.button
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={onPlay}
      className={clsx(
        'glass group focus-ring relative flex min-h-48 flex-col overflow-hidden rounded-3xl p-5 text-left sm:p-6',
        big && 'lg:min-h-full',
        className,
      )}
    >
      <div
        className="absolute inset-0 opacity-20 transition-opacity duration-300 group-hover:opacity-40"
        style={{ background: `radial-gradient(120% 90% at 100% 0%, ${a}, transparent 60%), radial-gradient(90% 80% at 0% 100%, ${b}55, transparent 70%)` }}
      />
      <span
        aria-hidden
        className={clsx(
          'absolute right-4 font-display leading-none font-black text-transparent opacity-60 transition-[transform,opacity] duration-500 group-hover:-rotate-3 group-hover:opacity-100',
          big ? 'top-4 text-[8rem]' : wide ? 'top-1 text-[7rem]' : 'top-3 text-[4.5rem]',
        )}
        style={{ WebkitTextStroke: `1.5px ${a}88`, backgroundImage: `linear-gradient(160deg, ${a}40, transparent 75%)`, WebkitBackgroundClip: 'text' }}
      >
        {BIG_LABEL[mode.id]}
      </span>

      <div className="relative flex items-center gap-2">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider text-white uppercase"
          style={{ background: `linear-gradient(90deg, ${a}, ${b})` }}
        >
          {mode.short}
        </span>
        {rating !== undefined && <RankBadge rating={rating} compact />}
      </div>
      <h3 className={clsx('relative mt-3 font-display font-bold', big || wide ? 'text-3xl sm:text-4xl' : 'text-2xl')}>{mode.name}</h3>
      <p className={clsx('relative mt-1 text-sm text-fg-2', wide ? 'max-w-md' : 'max-w-[17rem]')}>{mode.tagline}</p>
      {wide && <p className="relative mt-2 hidden max-w-md text-sm text-fg-3 sm:block">{mode.description}</p>}
      {big && (
        <>
          <p className="relative mt-3 max-w-xs text-sm text-fg-3">{mode.description}</p>
          <div className="relative mt-6 hidden max-w-xs flex-wrap gap-2 lg:flex">
            {CATEGORIES.map((c, i) => (
              <span
                key={c.id}
                title={c.name}
                className="grid size-10 place-items-center rounded-xl border border-line bg-white/5 text-lg transition-transform duration-300 group-hover:-translate-y-1"
                style={{ transitionDelay: `${i * 25}ms` }}
              >
                {c.icon}
              </span>
            ))}
          </div>
        </>
      )}

      <div className="relative mt-auto flex items-center justify-between pt-6">
        <span className="text-xs text-fg-3">
          {mode.questions} въпроса · {mode.timeMs / 1000} с
          {searching ? <span className="ml-2 text-emerald-300">● {searching} търсят</span> : null}
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-bold text-white shadow-lg transition-transform group-hover:translate-x-0.5"
          style={{ background: `linear-gradient(90deg, ${a}, ${b})`, boxShadow: `0 8px 24px -8px ${a}` }}
        >
          Играй <ArrowRight className="size-4" />
        </span>
      </div>
    </motion.button>
  );
}

function FriendsCard() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

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
    <Card className="relative overflow-hidden p-6 sm:p-7">
      <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-fuchsia-600/20 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-fuchsia-300">
          <Users className="size-5" />
          <span className="text-xs font-bold tracking-widest uppercase">С приятели</span>
        </div>
        <h2 className="mt-2 font-display text-xl font-bold">Частна стая</h2>
        <p className="mt-1 text-sm text-fg-3">До 8 играчи, твои правила. Сподели кода и започвай.</p>
        <Button className="mt-5 w-full" onClick={create} loading={busy === 'create'}>
          <Plus className="size-4" /> Създай стая
        </Button>
        <form onSubmit={join} className="mt-3 flex gap-2">
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
      </div>
    </Card>
  );
}

function UpNext({ level }: { level: number }) {
  const next = upcomingUnlocks(level, 1)[0];
  if (!next) return null;
  const { icon, name } = unlockPreview(next);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-fg-2">
      Ниво {next.level}: <span className="text-base leading-none">{icon}</span> {name}
    </span>
  );
}

/** Without a verified email a forgotten password means a lost account — nudge until one is added. */
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
  if (me.email || me.pendingEmail || dismissed) return null;
  return (
    <div className="glass flex flex-wrap items-center gap-3 rounded-2xl border-violet-400/30 px-5 py-3">
      <MailWarning className="size-5 text-violet-300" />
      <span className="min-w-0 flex-1 text-sm">
        Добави имейл, за да можеш да възстановиш паролата си, ако я забравиш.
      </span>
      <Button size="sm" variant="secondary" onClick={() => navigate('/settings')}>
        Добави имейл
      </Button>
      <button
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem('quiz:email-nudge', '1');
          } catch {
            /* storage unavailable */
          }
        }}
        aria-label="Скрий"
        className="focus-ring grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-white/5 hover:text-fg"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function SeasonChip({ ratings }: { ratings: Partial<Record<QueueModeId, number>> }) {
  const now = useNow(60_000);
  const id = seasonKey(now);
  const days = Math.max(1, Math.ceil((seasonEndsAt(id) - now) / 86_400_000));
  const best = Math.max(START_RATING, ...Object.values(ratings).filter((r): r is number => r !== undefined));
  return (
    <Link
      to="/leaderboard"
      className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-fg-2 hover:bg-white/10"
    >
      <Trophy className="size-3.5 text-amber-300" />
      Сезон {seasonName(id)} · още {days} {days === 1 ? 'ден' : 'дни'}
      <RankBadge rating={best} compact />
    </Link>
  );
}

const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
};

function DailyCard() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const now = useNow(1000);
  const [info, setInfo] = useState<DailyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [a, b] = MODES.daily.accent;

  useEffect(() => {
    api.daily().then(setInfo).catch(() => {});
  }, [me.daily.day, me.daily.played]);

  // Midnight in Sofia: a new challenge is up.
  const expired = !!info && now >= info.endsAt;
  useEffect(() => {
    if (expired) api.daily().then(setInfo).catch(() => {});
  }, [expired]);

  async function play() {
    setBusy(true);
    const res = await actions.startDaily();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  const dayLabel = info
    ? new Date(`${info.day}T12:00:00Z`).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: TIME_ZONE })
    : '';
  const streak = info?.streak ?? me.daily.streak;

  return (
    <Card className="relative overflow-hidden p-6 sm:p-7">
      <div
        className="absolute inset-0 opacity-25"
        style={{ background: `radial-gradient(100% 120% at 100% 0%, ${a}, transparent 55%), radial-gradient(80% 90% at 0% 100%, ${b}55, transparent 70%)` }}
      />
      <div className="relative grid gap-6 sm:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider text-amber-950 uppercase"
              style={{ background: `linear-gradient(90deg, ${a}, ${b})` }}
            >
              <CalendarDays className="size-3.5" /> Днес · {dayLabel}
            </span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-bold text-orange-300">
                <Flame className="size-3.5" /> {streak} {streak === 1 ? 'ден' : 'дни'} поред
              </span>
            )}
          </div>
          <h2 className="mt-3 font-display text-xl font-bold sm:text-2xl">{MODES.daily.name}</h2>
          <p className="mt-1 text-sm text-fg-2">{MODES.daily.tagline}</p>

          <div className="mt-auto pt-5">
            {info?.played ? (
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-xs text-fg-3">Твоят резултат</div>
                  <div className="text-2xl font-bold">
                    {fmt(info.played.score)}{' '}
                    <span className="text-base font-semibold text-amber-300">
                      #{info.played.rank} <span className="text-fg-3">от {info.total}</span>
                    </span>
                  </div>
                </div>
                <Button variant="secondary" className="ml-auto" onClick={() => navigate('/leaderboard?board=daily')}>
                  Класиране <ArrowRight className="size-4" />
                </Button>
              </div>
            ) : info?.attempted ? (
              <p className="text-sm text-fg-3">Днешният опит е използван. Ново предизвикателство след {countdown(info.endsAt - now)}.</p>
            ) : (
              <Button variant="gold" size="lg" onClick={play} loading={busy}>
                Играй днешното <ArrowRight className="size-5" />
              </Button>
            )}
            {info && !info.attempted && (
              <p className="mt-3 text-xs text-fg-3 tabular-nums">Изтича след {countdown(info.endsAt - now)}</p>
            )}
            {info?.played && <p className="mt-3 text-xs text-fg-3 tabular-nums">Ново след {countdown(info.endsAt - now)}</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-black/20 p-4">
          <p className="mb-3 text-xs font-bold tracking-widest text-fg-3 uppercase">Топ на деня</p>
          {info && info.entries.length > 0 ? (
            <ol className="space-y-2">
              {info.entries.slice(0, 3).map((e) => (
                <li key={e.user.id} className="flex items-center gap-2.5 text-sm">
                  <span className="w-5 text-center">{['🥇', '🥈', '🥉'][e.rank - 1]}</span>
                  <Avatar avatar={e.user.avatar} frame={e.user.frame} size={30} />
                  <span className={clsx('min-w-0 flex-1 truncate font-semibold', e.user.id === me.id && 'text-violet-300')}>
                    {e.user.username}
                  </span>
                  <span className="text-fg-2 tabular-nums">{fmt(e.value)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-4 text-center text-sm text-fg-3">Още никой не е играл днес. Бъди първият!</p>
          )}
          {info && info.total > 3 && <p className="mt-3 text-xs text-fg-3">+ още {info.total - 3} играчи днес</p>}
        </div>
      </div>
    </Card>
  );
}

function CommunityCard() {
  const me = useStore((s) => s.me)!;
  const navigate = useNavigate();
  const [pending, setPending] = useState<number | null>(null);
  const level = levelProgress(me.xp).level;
  const locked = level < SUBMISSION_RULES.minLevel;

  useEffect(() => {
    if (me.isAdmin) api.adminSubmissions('pending').then((r) => setPending(r.pending)).catch(() => {});
  }, [me.isAdmin]);

  return (
    <Card className="relative flex flex-col overflow-hidden p-6 sm:p-7">
      <div className="absolute -right-10 -bottom-16 size-48 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="relative flex items-center gap-2 text-emerald-300">
        <PenLine className="size-5" />
        <span className="text-xs font-bold tracking-widest uppercase">Общност</span>
      </div>
      <h2 className="relative mt-2 font-display text-xl font-bold">Предложи въпрос</h2>
      <p className="relative mt-1 text-sm text-fg-3">
        Знаеш нещо интересно? Изпрати въпрос — одобрените влизат в играта с твоето име и +{SUBMISSION_RULES.approvedXp} XP.
      </p>
      <div className="relative mt-auto flex flex-wrap gap-2 pt-5">
        <Button variant="secondary" onClick={() => navigate('/submit')} disabled={locked}>
          {locked ? (
            <>
              <Lock className="size-4" /> От ниво {SUBMISSION_RULES.minLevel}
            </>
          ) : (
            <>
              <PenLine className="size-4" /> Напиши въпрос
            </>
          )}
        </Button>
        {me.isAdmin && (
          <Button variant="ghost" onClick={() => navigate('/admin')}>
            <ShieldCheck className="size-4" /> Модерация
            {pending ? <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{pending}</span> : null}
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
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {options.map((c, i) => (
          <motion.button
            key={c.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025 }}
            disabled={busy !== null}
            onClick={() => start(c.id as CategoryChoice)}
            className={clsx(
              'focus-ring group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-line bg-white/[0.03] p-3.5 text-left transition-colors hover:bg-white/[0.07] disabled:opacity-60',
              c.id === 'mixed' && 'col-span-2 sm:col-span-3',
            )}
          >
            <span
              className="absolute inset-y-0 left-0 w-1 opacity-70 transition-all group-hover:w-1.5"
              style={{ background: c.color }}
            />
            <span className="text-2xl">{c.icon}</span>
            <span className="text-sm font-semibold">{c.name}</span>
            {c.id === 'mixed' && <span className="ml-auto text-xs text-fg-3">по малко от всичко</span>}
          </motion.button>
        ))}
      </div>
    </Modal>
  );
}
