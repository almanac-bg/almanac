import { actions, fmt, toast, useStore } from '@quiz/client';
import {
  CATEGORIES,
  type CategoryChoice,
  MIXED_CATEGORY,
  MODES,
  type ModeDef,
  type QueueModeId,
  RANK_TIERS,
  rankFor,
  SCORING,
  SEASON_MIN_GAMES,
  SEASON_REWARD_XP,
  START_RATING,
} from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, CircleHelp, Trophy } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { accentFill } from '../../lib/accent';
import { RankBadge } from '../Avatar';
import { SCORING_LINE } from '../game/scoring';
import { Button, buttonClass, Modal } from '../ui';

export function ModeCard({
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
            // -ml-1.5 takes back the padding (there for the hover and the 44 px target): the text lines up with the
            // chips when the row wraps, and the gap before it matches the others when it doesn't.
            <button
              type="button"
              onClick={onRankInfo}
              className="focus-ring relative z-10 -my-2.5 -ml-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1.5 hover:bg-white/5"
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
export function RankInfo({ mode, open, onClose }: { mode: QueueModeId; open: boolean; onClose: () => void }) {
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
        <p>
          <span className="font-semibold text-fg">Точките в мача:</span> {SCORING_LINE} „Двойно или нищо“ удвоява
          точките за въпроса (грешка струва {SCORING.doubleStake}), а „Втори шанс“ дава половината.
        </p>
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

export function SoloPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      {/* As many columns as fit tiles wide enough for the longest word („литература“, „Технологии“) beside the icon:
          one on a 320 px phone, two from 375; from tablets up the icon and padding grow, so the tiles do too (two
          wide columns in the dialog, not three cramped ones that split the word). */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
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
