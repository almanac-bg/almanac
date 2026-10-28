import { fmt, plural, type ReviewItem, unlockPreview, useStore } from '@quiz/client';
import {
  achievementById,
  type CategoryMastery,
  categoryById,
  type DailySharer,
  dayKey,
  levelFromXp,
  levelProgress,
  MASTERY_TIERS,
  type MatchRewards,
  masteryName,
  RARITIES,
  RATED_AFTER,
  RATED_GAMES_PER_PAIR,
  rankFor,
  type UnratedReason,
} from '@quiz/shared';
import clsx from 'clsx';
import { Share2 } from 'lucide-react';
import { animate, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { dailyLinkUrl, offBoardWhy } from '../../lib/daily';
import { dailyShareText, rememberDailyShare, shareText } from '../../lib/share';
import { sfx } from '../../lib/sound';
import { Avatar, LevelBadge, RankBadge } from '../Avatar';
import { Button, Card } from '../ui';
import { burst } from './confetti';
import { DayField } from './DayField';

/**
 * The day's standing (or, off the board, where the run would stand on it), the friend whose link it came from, and the
 * streak. Sharing sends the player's own link to the same questions. The full board is the action bar's.
 */
export function DailyCard({
  daily,
  history,
  total,
  score,
}: {
  daily: NonNullable<MatchRewards['daily']>;
  history: ReviewItem[];
  total: number;
  score: number;
}) {
  const me = useStore((s) => s.me);
  const day = dayKey();
  const [link, setLink] = useState<string | null>(null);
  // Asked for once: the same link all day, whichever screen shares it.
  useEffect(() => {
    void dailyLinkUrl().then(setLink);
  }, []);
  const text =
    link &&
    dailyShareText({
      history,
      total,
      day,
      score,
      place: daily.offBoard ? null : { rank: daily.rank, of: daily.total },
      streak: daily.streak,
      link,
    });
  useEffect(() => {
    if (text) rememberDailyShare(text, day);
  }, [text, day]);
  const madeToday = !!me && dayKey(me.createdAt) === day;

  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -right-12 size-48 rounded-full glow text-amber-400/25" />
      <h2 className="relative t-card">{daily.offBoard ? 'Щеше да си днес' : 'Твоето място днес'}</h2>
      <div className="relative mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl font-black text-amber-300">#{daily.rank}</span>
        <span className="text-fg-2">от {fmt(daily.offBoard ? daily.total + 1 : daily.total)} днес</span>
      </div>
      {daily.offBoard && (
        <p className="relative mt-2 text-sm text-fg-2">{offBoardWhy({ guest: !!me?.isGuest, madeToday })}</p>
      )}
      {daily.field && (
        <DayField field={daily.field} correct={history.filter((h) => h.right).length} className="relative mt-4" />
      )}
      {daily.sharer && (
        <AgainstSharer sharer={daily.sharer} score={score} correct={history.filter((h) => h.right).length} of={total} />
      )}
      {daily.streak > 0 && (
        <p className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-bold text-orange-300">
          🔥 Серия {plural(daily.streak, 'ден', 'дни')}
        </p>
      )}
      {daily.shieldsUsed > 0 && (
        <p className="relative mt-3 flex items-start gap-2.5 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-3.5 py-2.5 text-sm text-sky-100">
          <span aria-hidden className="text-lg leading-5">
            🛡️
          </span>
          {daily.shieldsUsed === 1
            ? 'Щит спаси серията ти: пропуснатият ден не я прекъсна.'
            : `${daily.shieldsUsed} щита спасиха серията ти: пропуснатите дни не я прекъснаха.`}
        </p>
      )}
      {daily.shieldEarned && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.1, type: 'spring', stiffness: 260, damping: 18 }}
          className="relative mt-3 flex items-center gap-3 rounded-2xl border border-sky-300/35 bg-[linear-gradient(110deg,rgb(56_189_248/0.22),rgb(167_139_250/0.14))] px-3.5 py-3"
        >
          <span aria-hidden className="text-3xl leading-none drop-shadow-[0_0_14px_rgb(56_189_248/0.7)]">
            🛡️
          </span>
          <p className="text-sm text-sky-50">
            <b className="font-display">Имаш нов щит!</b> Ако пропуснеш ден, той ще запази серията.
          </p>
        </motion.div>
      )}
      <p className="relative mt-3 text-xs text-fg-3">Класирането се променя, докато другите играят — до полунощ.</p>
      <div className="relative mt-4">
        <Button size="sm" onClick={() => text && shareText(text, 'Линкът и резултатът са копирани')} disabled={!text}>
          <Share2 className="size-4" /> Прати днешните въпроси
        </Button>
        <p className="mt-2 text-xs text-fg-3">Който отвори линка, играе същите 10 — и ти казваме как се е справил.</p>
      </div>
    </Card>
  );
}

/** The friend whose link this was: their day against yours. */
function AgainstSharer({
  sharer,
  score,
  correct,
  of,
}: {
  sharer: DailySharer;
  score: number;
  correct: number;
  of: number;
}) {
  const me = useStore((s) => s.me);
  const verdict = score > sharer.score ? 'Би го!' : score < sharer.score ? `${sharer.user.username} води` : 'Равни сте';
  return (
    <div className="relative mt-4 rounded-2xl border border-line bg-black/20 p-3.5">
      <p className="t-eyebrow text-fg-3">По линка на {sharer.user.username}</p>
      <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
        <Avatar avatar={sharer.user.avatar} frame={sharer.user.frame} size={28} />
        <span className="min-w-0 truncate font-semibold">{sharer.user.username}</span>
        <span className="text-fg-2 tabular-nums">
          {sharer.correct}/{of} · {fmt(sharer.score)} т.
        </span>
        {me ? <Avatar avatar={me.avatar} frame={me.frame} size={28} /> : <span />}
        <span className="font-semibold text-violet-300">Ти</span>
        <span className="text-fg-2 tabular-nums">
          {correct}/{of} · {fmt(score)} т.
        </span>
      </div>
      <p className="mt-2 font-display text-base font-bold text-amber-300">{verdict}</p>
    </div>
  );
}

/** Lines shown before "още": the biggest ones; the rest is a tap away. */
const SHOWN_LINES = 3;

/** XP and the level bar. `quiet`: a lost match — a level gained along the way gets its line, not confetti. */
export function RewardsCard({ rewards, quiet = false }: { rewards: MatchRewards; quiet?: boolean }) {
  const [xp, setXp] = useState(rewards.xpBefore);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [allLines, setAllLines] = useState(false);
  // Largest first: folded, the lines shown are the ones that made the total.
  const breakdown = [...rewards.breakdown].sort((a, b) => b.amount - a.amount);
  const folded = !allLines && breakdown.length > SHOWN_LINES + 1;
  const lines = folded ? breakdown.slice(0, SHOWN_LINES) : breakdown;

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
          if (!quiet) burst(0.7);
        }
      },
    });
    return () => controls.stop();
  }, [rewards, quiet]);

  const p = levelProgress(Math.round(xp));
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -left-10 size-48 rounded-full glow text-violet-600/25" />
      <div className="relative flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="t-card">Награди</h2>
        <span className="font-display text-2xl font-black text-violet-300 sm:text-3xl">
          +{fmt(rewards.xpGained)} XP
        </span>
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
        {lines.map((line, i) => (
          <motion.li
            key={line.label}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.08 }}
            className="flex justify-between gap-4 border-b border-line/60 pb-1.5 last:border-0"
          >
            <span className="min-w-0 text-fg-2">{line.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">+{fmt(line.amount)}</span>
          </motion.li>
        ))}
      </ul>
      {folded && (
        <button
          type="button"
          onClick={() => setAllLines(true)}
          className="focus-ring relative mt-2 rounded-lg text-sm font-semibold text-violet-300 hover:underline"
        >
          + още {breakdown.length - SHOWN_LINES} {breakdown.length - SHOWN_LINES === 1 ? 'ред' : 'реда'}
        </button>
      )}
    </Card>
  );
}

/** The rating change in a word, for the results' headline (the card below has the rank). */
export function RatingChip({ rating }: { rating: { before: number; after: number } }) {
  const delta = rating.after - rating.before;
  return (
    <span
      className={clsx(
        'rounded-full px-3 py-1 tabular-nums',
        delta >= 0 ? 'bg-emerald-500/15 text-emerald-200' : 'bg-rose-500/15 text-rose-200',
      )}
    >
      Рейтинг {fmt(rating.after)} ({delta >= 0 ? `+${delta}` : `−${-delta}`})
    </span>
  );
}

export function AchievementsCard({ ids }: { ids: string[] }) {
  useEffect(() => {
    const t = setTimeout(sfx.achievement, 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <Card className="p-6">
      <h2 className="t-card">Нови постижения</h2>
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
              style={{
                borderColor: `${rarity.color}55`,
                background: `linear-gradient(110deg, ${rarity.color}1f, transparent 70%)`,
              }}
            >
              <span className="grid size-11 place-items-center rounded-xl bg-black/30 text-2xl">{a.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-fg-3">{a.description}</div>
              </div>
              <div className="shrink-0 text-right text-xs">
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

/** Category mastery this match earned: a tier in a category, and its title to wear. */
export function MasteryCard({ mastery }: { mastery: CategoryMastery[] }) {
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -right-12 size-48 rounded-full glow text-emerald-400/20" />
      <h2 className="relative t-card">Майсторство</h2>
      <ul className="relative mt-4 space-y-3">
        {mastery.map((m, i) => {
          const tier = MASTERY_TIERS[m.tier];
          const category = categoryById(m.category);
          return (
            <motion.li
              key={m.category}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1 + i * 0.1, type: 'spring', stiffness: 260, damping: 18 }}
              className="flex items-center gap-3"
            >
              <span aria-hidden className="text-4xl leading-none">
                {tier.icon}
              </span>
              <div className="min-w-0">
                <p className="font-display text-lg font-bold">{masteryName(m)}</p>
                <p className="text-sm text-fg-2">{category?.icon} Нова степен — и титла, която можеш да носиш.</p>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </Card>
  );
}

export function UnlocksCard({ rewards }: { rewards: MatchRewards }) {
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <h2 className="t-card">Отключено</h2>
        <Link
          to="/locker"
          className="focus-ring -my-2.5 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-violet-300 hover:text-violet-200"
        >
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

/** A ranked match that left the rating as it was, and why (instead of a puzzling "+0"). */
const UNRATED: Record<Exclude<UnratedReason, 'no_contest' | 'guest'>, string> = {
  pair: `Двамата вече изиграхте ${RATED_GAMES_PER_PAIR} мача с рейтинг днес — до утре мачовете ви са без рейтинг.`,
  cut: 'Мачът приключи по-рано заради нас (обновяване или грешка), затова не променя рейтинга.',
  new: `Профилът ти е нов: срещу хора играеш с рейтинг, щом е на поне ден и има ${RATED_AFTER.games} мача (срещу ботове — от първия).`,
  new_rival:
    'Съперникът ти е с нов профил: срещу него мачът е без рейтинг, докато профилът му не навърти първия си ден и мачове.',
};

export function UnratedCard({ reason, guest }: { reason: Exclude<UnratedReason, 'no_contest'>; guest: boolean }) {
  return (
    <Card className="p-6">
      <h2 className="t-card">Рейтинг</h2>
      <p className="mt-2 text-sm text-fg-2">
        {reason !== 'guest'
          ? UNRATED[reason]
          : guest
            ? 'Като гост играеш срещу хора без рейтинг (срещу ботове — с рейтинг). Запази профила си, за да се класираш.'
            : 'Мачовете срещу гости са без рейтинг.'}
      </p>
    </Card>
  );
}

export function RatingCard({ rating }: { rating: { before: number; after: number } }) {
  const delta = rating.after - rating.before;
  const promoted = rankFor(rating.after).id !== rankFor(rating.before).id && delta > 0;
  return (
    <Card className="flex items-center justify-between gap-4 p-6">
      <div>
        <h2 className="t-card">Рейтинг</h2>
        <div className="mt-2 flex items-center gap-2">
          <RankBadge rating={rating.after} />
          {promoted && <span className="text-sm font-bold text-amber-300">Нов ранг!</span>}
        </div>
      </div>
      <span
        className={clsx(
          'font-display text-3xl font-black tabular-nums',
          delta >= 0 ? 'text-emerald-300' : 'text-rose-300',
        )}
      >
        {delta >= 0 ? '+' : ''}
        {delta}
      </span>
    </Card>
  );
}
