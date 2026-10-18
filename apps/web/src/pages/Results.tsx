import {
  achievementById,
  categoryById,
  type FinalStanding,
  type GameEndPayload,
  isQueueMode,
  levelFromXp,
  levelProgress,
  type MatchRewards,
  MODES,
  RARITIES,
  rankFor,
  type TeamId,
  TEAMS,
} from '@quiz/shared';
import confetti from 'canvas-confetti';
import clsx from 'clsx';
import { ArrowRight, ChartColumn, Home, RotateCcw, Skull } from 'lucide-react';
import { animate, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, LevelBadge, PlayerTag, RankBadge } from '../components/Avatar';
import { teamColor } from '../components/game/teams';
import { Button, Card } from '../components/ui';
import { fmt, ordinal, plural } from '../lib/format';
import { actions } from '../lib/socket';
import { sfx } from '../lib/sound';
import { type LiveGame, toast, useStore } from '../lib/store';
import { unlockPreview } from '../lib/unlocks';

const CONFETTI_COLORS = ['#a78bfa', '#e879f9', '#22d3ee', '#fbbf24', '#34d399'];

function burst(power = 1) {
  const opts = { colors: CONFETTI_COLORS, disableForReducedMotion: true };
  void confetti({ ...opts, particleCount: Math.round(90 * power), spread: 75, origin: { y: 0.35 }, startVelocity: 45 });
  setTimeout(() => {
    void confetti({ ...opts, particleCount: Math.round(50 * power), angle: 60, spread: 60, origin: { x: 0, y: 0.6 } });
    void confetti({ ...opts, particleCount: Math.round(50 * power), angle: 120, spread: 60, origin: { x: 1, y: 0.6 } });
  }, 250);
}

export function Results({ game }: { game: LiveGame }) {
  const end = game.end!;
  const navigate = useNavigate();
  const room = useStore((s) => s.room);
  const [busy, setBusy] = useState(false);
  const youId = game.start.youId;
  const mine = end.standings.find((s) => s.id === youId)!;
  const solo = end.mode === 'solo';
  const daily = end.mode === 'daily';
  const single = game.start.players.length === 1;
  const teamScores = end.teamScores;
  const winningTeam = teamScores?.[0].team ?? null;
  const won = !single && mine.placement === 1;
  const perfect = mine.correct === game.start.totalQuestions;
  const rewards = end.rewards;

  useEffect(() => {
    if (won || (single && perfect)) {
      sfx.win();
      burst(1.2);
    }
  }, [won, single, perfect]);

  async function again() {
    const mode = end.mode;
    if (mode === 'custom') {
      actions.closeGame();
      navigate(room ? '/room' : '/');
      return;
    }
    if (mode === 'solo') {
      setBusy(true);
      const res = await actions.startSolo(game.start.category);
      setBusy(false);
      if (!res.ok) toast({ kind: 'error', title: res.error });
      return;
    }
    if (isQueueMode(mode)) {
      actions.closeGame();
      navigate('/');
      const res = await actions.joinQueue(mode);
      if (!res.ok) toast({ kind: 'error', title: res.error });
    }
  }

  function home() {
    actions.closeGame();
    navigate('/');
  }

  function dailyBoard() {
    actions.closeGame();
    navigate('/leaderboard?board=daily');
  }

  const category = categoryById(game.start.category);
  const headline = daily
    ? perfect
      ? 'Перфектен ден!'
      : 'Денят е изигран'
    : solo
      ? perfect
        ? 'Перфектно!'
        : 'Край на играта'
      : teamScores
        ? won
          ? 'ПОБЕДА!'
          : 'Загуба'
        : won
          ? 'ПОБЕДА!'
          : `${ordinal(mine.placement)} място`;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 pb-20 sm:px-6">
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <p className="text-xs font-bold tracking-[0.3em] text-fg-3 uppercase">
          {MODES[end.mode].name}
          {solo && category && ` · ${category.name}`}
        </p>
        <motion.h1
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.1 }}
          className={clsx(
            'mt-3 font-display text-[clamp(2.6rem,9vw,5rem)] leading-none font-black',
            won ? 'bg-[linear-gradient(100deg,#fde68a,#f59e0b,#fde68a)] bg-clip-text text-transparent' : 'text-gradient',
          )}
        >
          {headline}
        </motion.h1>
        {winningTeam !== null && (
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-3 font-display text-xl font-bold"
            style={{ color: teamColor(winningTeam), textShadow: `0 0 24px ${teamColor(winningTeam)}88` }}
          >
            {TEAMS[winningTeam].name} печелят!
          </motion.p>
        )}
        <p className="mt-3 text-fg-2">
          {mine.eliminatedAt !== null ? (
            <span className="inline-flex items-center gap-1.5">
              <Skull className="size-4 text-rose-300" /> Отпадна след въпрос {mine.eliminatedAt}
            </span>
          ) : (
            <>
              <b className="text-fg">{fmt(mine.score)}</b> точки · {mine.correct} от {game.start.totalQuestions} верни
            </>
          )}
        </p>
      </motion.header>

      {teamScores ? <TeamResult game={game} end={end} /> : !single && <Podium game={game} standings={end.standings} />}

      <div className="mt-10 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {rewards ? (
          <RewardsCard rewards={rewards} />
        ) : (
          <Card className="p-6 text-sm text-fg-3">Наградите от този мач не можаха да се запишат.</Card>
        )}
        <div className="space-y-4">
          {rewards?.daily && <DailyCard daily={rewards.daily} onBoard={dailyBoard} />}
          {rewards && rewards.achievements.length > 0 && <AchievementsCard ids={rewards.achievements} />}
          {rewards && rewards.unlocks.length > 0 && <UnlocksCard rewards={rewards} />}
          {rewards?.rating && <RatingCard rating={rewards.rating} />}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {daily ? (
          // One attempt a day — no "play again".
          <Button size="lg" onClick={dailyBoard}>
            <ChartColumn className="size-5" /> Класиране за деня
          </Button>
        ) : (
          <Button size="lg" onClick={again} loading={busy}>
            {end.mode === 'custom' ? (
              <>
                Обратно в стаята <ArrowRight className="size-5" />
              </>
            ) : (
              <>
                <RotateCcw className="size-5" /> Играй пак
              </>
            )}
          </Button>
        )}
        <Button size="lg" variant="secondary" onClick={home}>
          <Home className="size-5" /> {daily ? 'Към началото' : 'Начало'}
        </Button>
      </div>
    </div>
  );
}

function Podium({ game, standings }: { game: LiveGame; standings: FinalStanding[] }) {
  const top = standings.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const heights: Record<number, string> = { 1: 'h-36 sm:h-44', 2: 'h-24 sm:h-32', 3: 'h-16 sm:h-24' };
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const rest = standings.slice(3);

  return (
    <section className="mt-10">
      <div className="flex items-end justify-center gap-3 sm:gap-6">
        {order.map((s) => {
          const p = game.players[s.id];
          const me = s.id === game.start.youId;
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + (3 - s.placement) * 0.2, type: 'spring', stiffness: 180, damping: 18 }}
              className="flex w-28 flex-col items-center sm:w-40"
            >
              {s.placement === 1 && (
                <motion.span
                  initial={{ y: -20, opacity: 0, rotate: -20 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ delay: 1, type: 'spring' }}
                  className="text-4xl drop-shadow-[0_0_16px_rgb(251_191_36/0.7)]"
                >
                  👑
                </motion.span>
              )}
              <Avatar avatar={p.avatar} frame={p.frame} size={s.placement === 1 ? 92 : 72} />
              <div className={clsx('mt-2 flex max-w-full items-center gap-1 text-sm font-semibold', me && 'text-violet-300')}>
                <span className="truncate">{p.name}</span>
                <LevelBadge level={p.level} />
              </div>
              <div className="text-xs text-fg-3 tabular-nums">{fmt(s.score)} т.</div>
              <div
                className={clsx(
                  'mt-3 grid w-full place-items-start justify-center rounded-t-2xl border border-b-0 border-line pt-3 text-3xl',
                  heights[s.placement],
                  s.placement === 1
                    ? 'bg-[linear-gradient(180deg,rgb(251_191_36/0.3),rgb(251_191_36/0.02))]'
                    : 'bg-[linear-gradient(180deg,rgb(255_255_255/0.08),rgb(255_255_255/0.01))]',
                )}
              >
                {medals[s.placement]}
              </div>
            </motion.div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <Card className="mx-auto mt-0 max-w-xl rounded-t-none p-2">
          {rest.map((s) => {
            const p = game.players[s.id];
            return (
              <div
                key={s.id}
                className={clsx('flex items-center gap-3 rounded-2xl px-3 py-2', s.id === game.start.youId && 'bg-violet-500/12')}
              >
                <span className="w-8 text-sm font-bold text-fg-3">{ordinal(s.placement)}</span>
                <Avatar avatar={p.avatar} frame={p.frame} size={34} dim={s.left} />
                <div className="min-w-0 flex-1 text-sm">
                  <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
                </div>
                <span className="text-sm text-fg-2 tabular-nums">
                  {s.left ? 'напусна' : s.eliminatedAt !== null ? `💀 ${s.eliminatedAt}` : fmt(s.score)}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/** Team games: two columns with totals and members, the winners crowned. */
function TeamResult({ game, end }: { game: LiveGame; end: GameEndPayload }) {
  const scores = end.teamScores!;
  const winner = scores[0].team;
  const myTeam = game.players[game.start.youId]?.team ?? null;
  return (
    <section className="mt-10 grid gap-4 sm:grid-cols-2">
      {([0, 1] as TeamId[]).map((team) => {
        const color = teamColor(team);
        const won = team === winner;
        const total = scores.find((x) => x.team === team)?.score ?? 0;
        const members = end.standings.filter((s) => game.players[s.id]?.team === team).sort((a, b) => b.score - a.score);
        return (
          <motion.div
            key={team}
            initial={{ opacity: 0, x: team === 0 ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + team * 0.12, type: 'spring', stiffness: 180, damping: 20 }}
          >
            <Card
              className={clsx('relative h-full overflow-hidden p-5', !won && 'opacity-85')}
              style={{ borderColor: won ? `${color}99` : `${color}33`, boxShadow: won ? `0 0 48px -16px ${color}` : undefined }}
            >
              <div className="absolute -top-16 -right-10 size-48 rounded-full opacity-25 blur-3xl" style={{ background: color }} />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold" style={{ color }}>
                    {won && <span className="mr-1.5">👑</span>}
                    {TEAMS[team].name}
                  </p>
                  <p className="text-xs text-fg-3">{myTeam === team ? 'Твоят отбор' : 'Съперници'}</p>
                </div>
                <span className="font-display text-3xl font-black tabular-nums">{fmt(total)}</span>
              </div>
              <div className="relative mt-4 space-y-1.5">
                {members.map((s) => {
                  const p = game.players[s.id];
                  return (
                    <div
                      key={s.id}
                      className={clsx('flex items-center gap-3 rounded-2xl px-2 py-2', s.id === game.start.youId && 'bg-violet-500/12')}
                    >
                      <Avatar avatar={p.avatar} frame={p.frame} size={36} dim={s.left} />
                      <div className="min-w-0 flex-1 text-sm">
                        <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
                      </div>
                      <span className="text-sm font-semibold text-fg-2 tabular-nums">{s.left ? 'напусна' : fmt(s.score)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        );
      })}
    </section>
  );
}

function DailyCard({ daily, onBoard }: { daily: NonNullable<MatchRewards['daily']>; onBoard: () => void }) {
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -right-12 size-48 rounded-full bg-amber-400/25 blur-3xl" />
      <h2 className="relative font-display text-lg font-bold">Класиране за деня</h2>
      <div className="relative mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl font-black text-amber-300">#{daily.rank}</span>
        <span className="text-fg-2">от {fmt(daily.total)} днес</span>
      </div>
      {daily.streak > 0 && (
        <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-bold text-orange-300">
          🔥 Серия {plural(daily.streak, 'ден', 'дни')}
        </p>
      )}
      <p className="relative mt-3 text-xs text-fg-3">Класирането се променя, докато другите играят — до полунощ.</p>
      <button onClick={onBoard} className="relative mt-3 text-sm font-semibold text-amber-300 hover:text-amber-200">
        Виж класирането →
      </button>
    </Card>
  );
}

function RewardsCard({ rewards }: { rewards: MatchRewards }) {
  const [xp, setXp] = useState(rewards.xpBefore);
  const [levelUp, setLevelUp] = useState<number | null>(null);

  useEffect(() => {
    let lastLevel = levelFromXp(rewards.xpBefore);
    const controls = animate(rewards.xpBefore, rewards.xpAfter, {
      duration: Math.min(3, 1 + rewards.xpGained / 600),
      delay: 0.8,
      ease: [0.2, 0.6, 0.3, 1],
      onUpdate: (v) => {
        setXp(v);
        const l = levelFromXp(v);
        if (l > lastLevel) {
          lastLevel = l;
          setLevelUp(l);
          sfx.levelUp();
          burst(0.7);
        }
      },
    });
    return () => controls.stop();
  }, [rewards]);

  const p = levelProgress(Math.round(xp));
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -left-10 size-48 rounded-full bg-violet-600/25 blur-3xl" />
      <div className="relative flex items-baseline justify-between">
        <h2 className="font-display text-lg font-bold">Награди</h2>
        <span className="font-display text-3xl font-black text-violet-300">+{fmt(rewards.xpGained)} XP</span>
      </div>

      <div className="relative mt-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <motion.span key={p.level} initial={{ scale: 1.8 }} animate={{ scale: 1 }}>
              <LevelBadge level={p.level} className="text-sm" />
            </motion.span>
            Ниво {p.level}
          </span>
          <span className="text-fg-3 tabular-nums">
            {fmt(p.into)} / {fmt(p.needed)}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#a855f7,#e879f9,#22d3ee)] shadow-[0_0_16px_rgb(168_85_247/0.8)]"
            style={{ width: `${p.pct * 100}%` }}
          />
        </div>
        {levelUp && (
          <motion.div
            key={levelUp}
            initial={{ opacity: 0, scale: 0.5, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="mt-4 rounded-2xl bg-[linear-gradient(110deg,rgb(168_85_247/0.25),rgb(34_211_238/0.2))] p-3 text-center font-display font-bold"
          >
            ⬆️ Ново ниво {levelUp}!
          </motion.div>
        )}
      </div>

      <ul className="relative mt-5 space-y-1.5 text-sm">
        {rewards.breakdown.map((line, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            className="flex justify-between gap-4 border-b border-line/60 pb-1.5 last:border-0"
          >
            <span className="text-fg-2">{line.label}</span>
            <span className="font-semibold tabular-nums">+{fmt(line.amount)}</span>
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function AchievementsCard({ ids }: { ids: string[] }) {
  useEffect(() => {
    const t = setTimeout(sfx.achievement, 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <Card className="p-6">
      <h2 className="font-display text-lg font-bold">Нови постижения</h2>
      <div className="mt-4 space-y-2.5">
        {ids.map((id, i) => {
          const a = achievementById(id)!;
          const rarity = RARITIES[a.rarity];
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, rotateX: -90 }}
              animate={{ opacity: 1, rotateX: 0 }}
              transition={{ delay: 1 + i * 0.18, type: 'spring', stiffness: 200, damping: 18 }}
              className="flex items-center gap-3 rounded-2xl border p-3"
              style={{ borderColor: `${rarity.color}55`, background: `linear-gradient(110deg, ${rarity.color}1f, transparent 70%)` }}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-black/30 text-2xl">{a.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="truncate text-xs text-fg-3">{a.description}</div>
              </div>
              <div className="text-right text-xs">
                <div className="font-bold" style={{ color: rarity.color }}>
                  {rarity.name}
                </div>
                <div className="text-fg-3">+{a.xp} XP</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function UnlocksCard({ rewards }: { rewards: MatchRewards }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Отключи</h2>
        <Link to="/locker" className="text-sm font-semibold text-violet-300 hover:text-violet-200">
          Към колекцията →
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {rewards.unlocks.map((u, i) => {
          const { icon, name } = unlockPreview(u);
          return (
            <motion.span
              key={`${u.kind}:${u.id}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.2 + i * 0.06 }}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white/5 px-3 py-2 text-sm"
            >
              <span className="text-lg leading-none">{icon}</span>
              {name}
            </motion.span>
          );
        })}
      </div>
    </Card>
  );
}

function RatingCard({ rating }: { rating: { before: number; after: number } }) {
  const delta = rating.after - rating.before;
  const promoted = rankFor(rating.after).id !== rankFor(rating.before).id && delta > 0;
  return (
    <Card className="flex items-center justify-between gap-4 p-6">
      <div>
        <h2 className="font-display text-lg font-bold">Рейтинг</h2>
        <div className="mt-2 flex items-center gap-2">
          <RankBadge rating={rating.after} />
          {promoted && <span className="text-sm font-bold text-amber-300">Нов ранг!</span>}
        </div>
      </div>
      <span className={clsx('font-display text-3xl font-black tabular-nums', delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
        {delta >= 0 ? '+' : ''}
        {delta}
      </span>
    </Card>
  );
}
