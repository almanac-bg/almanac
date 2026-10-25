import {
  actions,
  fmt,
  getState,
  type LiveGame,
  ordinal,
  plural,
  type ReviewItem,
  toast,
  unlockPreview,
  useStore,
} from '@quiz/client';
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
  RATED_GAMES_PER_PAIR,
  rankFor,
  TEAMS,
  type TeamId,
  type UnratedReason,
} from '@quiz/shared';
import confetti from 'canvas-confetti';
import clsx from 'clsx';
import { ArrowRight, ChartColumn, Home, RotateCcw, Share2, Skull, Swords } from 'lucide-react';
import { animate, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Avatar, LevelBadge, PlayerTag, RankBadge } from '../components/Avatar';
import { GuestNudge } from '../components/ClaimAccount';
import { QuestionReview } from '../components/game/QuestionReview';
import { teamColor } from '../components/game/teams';
import { challengeShareText } from '../components/home/challengeLink';
import { FriendButton, FriendsProvider } from '../components/results/FriendButton';
import { RematchStrip, useRematch } from '../components/results/Rematch';
import { Button, Card } from '../components/ui';
import { dailyShareText, rememberDailyShare, shareText } from '../lib/share';
import { sfx } from '../lib/sound';

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
  const guest = useStore((s) => !!s.me?.isGuest);
  const [busy, setBusy] = useState(false);
  const youId = game.start.youId;
  const mine = end.standings.find((s) => s.id === youId)!;
  const solo = end.mode === 'solo';
  const daily = end.mode === 'daily';
  const challenge = end.mode === 'challenge';
  const single = game.start.players.length === 1;
  const teamScores = end.teamScores;
  const winningTeam = teamScores?.[0].team ?? null;
  const rewards = end.rewards;
  // A challenge link is played alone, but it has a board: first place over others is a win too.
  const link = rewards?.challenge ?? null;
  const won = (!single && mine.placement === 1 && !end.noContest) || (!!link && link.rank === 1 && link.total > 1);
  // Everyone else walked out (after the match got going, or it would be no contest).
  const byWalkout = won && !teamScores && end.standings.every((s) => s.id === youId || s.left);
  const rivals = end.standings.length > 2 ? 'Съперниците напуснаха' : 'Съперникът напусна';
  const perfect = mine.correct === game.start.totalQuestions;
  // A no contest says so in the headline; the other reasons a rating stayed put get a card.
  const unrated = rewards?.unrated && rewards.unrated !== 'no_contest' ? rewards.unrated : null;
  // A no contest has no podium to show, and nothing to award unless a question or two were answered.
  const rewardsCard = !end.noContest || (!!rewards && rewards.xpGained > 0);
  const sideCards =
    !!rewards &&
    (!!rewards.daily || rewards.achievements.length > 0 || rewards.unlocks.length > 0 || !!rewards.rating || !!unrated);
  const rematch = useRematch(game);
  const headlineRef = useRef<HTMLHeadingElement>(null);

  // The match just ended: start from the top, with focus (and screen readers) on the outcome.
  useEffect(() => {
    window.scrollTo(0, 0);
    headlineRef.current?.focus({ preventScroll: true });
  }, []);

  // Off to another page (a board, the back button): the finished match is dropped once this screen is gone. Dropping
  // it before the route changes would make /game send the player home first. Checked a tick later, so a new match
  // taking over or a remount on the same screen (StrictMode) keeps it.
  const gameId = end.gameId;
  useEffect(
    () => () => {
      setTimeout(() => {
        if (getState().game?.start.gameId === gameId && window.location.pathname !== '/game') actions.closeGame();
      }, 0);
    },
    [gameId],
  );

  useEffect(() => {
    if (won || (single && perfect)) {
      sfx.win();
      burst(1.2);
    }
  }, [won, single, perfect]);

  async function again() {
    const mode = end.mode;
    if (mode === 'challenge') {
      // A link plays once; "again" is a new link of your own (the match opens by itself).
      setBusy(true);
      const res = await actions.startChallenge();
      setBusy(false);
      if (!res.ok) toast({ kind: 'error', title: res.error });
      return;
    }
    if (mode === 'custom') {
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

  const dailyBoard = () => navigate('/leaderboard?board=daily');
  const linkBoard = (id: string) => navigate(`/c/${id}`);

  const category = categoryById(game.start.category);
  const headline = end.noContest
    ? rivals
    : daily
      ? perfect
        ? 'Перфектен ден!'
        : 'Денят е изигран'
      : link
        ? link.total <= 1
          ? mine.score > 0
            ? 'Летвата е поставена!'
            : 'Линкът е готов'
          : link.rank === 1
            ? 'Първо място!'
            : `${ordinal(link.rank)} място`
        : single
          ? perfect
            ? 'Перфектно!'
            : 'Край на мача'
          : teamScores
            ? won
              ? 'Победа!'
              : 'Загуба'
            : won
              ? 'Победа!'
              : `${ordinal(mine.placement)} място`;
  // A long word ("Перфектно!", "поставена!") is wider than a small phone at the usual size: such headlines scale with
  // the screen instead (10vw always leaves room for ten letters).
  const longWord = headline.split(' ').some((w) => w.length > 7);

  return (
    // No bottom padding on phones: the sticky action bar ends the page.
    <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6 sm:pb-20">
      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="t-eyebrow text-fg-3">
          {MODES[end.mode].name}
          {solo && category && ` · ${category.name}`}
        </p>
        <motion.h1
          ref={headlineRef}
          tabIndex={-1}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.1 }}
          className={clsx(
            'mt-3 font-display leading-none font-black outline-none',
            longWord ? 'text-[clamp(1.75rem,8.5vw,4.5rem)]' : 'text-[clamp(2.25rem,7vw,4.5rem)]',
            'text-balance',
            won
              ? 'bg-[linear-gradient(100deg,#fde68a,#f59e0b,#fde68a)] bg-clip-text text-transparent'
              : 'text-gradient',
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
        {!end.noContest && (
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
        )}
        {(end.noContest || byWalkout) && (
          <p className={clsx('mx-auto max-w-md text-fg-3', end.noContest ? 'mt-4' : 'mt-2 text-sm')}>
            {end.noContest
              ? 'Още в началото, затова мачът не се зачита: без победа и без промяна в рейтинга.'
              : `${rivals} по време на мача — победата е твоя.`}
          </p>
        )}
      </motion.header>

      {/* The standings offer "+ Приятел" beside each person you played with. */}
      <FriendsProvider game={game}>
        {teamScores ? (
          <TeamResult game={game} end={end} />
        ) : (
          !single && !end.noContest && <Podium game={game} standings={end.standings} />
        )}
      </FriendsProvider>
      {link && (
        <ChallengeStanding
          challenge={link}
          score={mine.score}
          questions={game.start.totalQuestions}
          onBoard={() => linkBoard(link.id)}
        />
      )}
      {/* Phones keep the offer in the sticky bar at the bottom; wider screens show it here, under who played. */}
      {rematch && <RematchStrip rematch={rematch} className="mt-6 max-sm:hidden" />}

      {/* Explicit minmax(0, …) columns: an implicit auto column would grow to the widest line and push the page sideways.
          With nothing for the second column (a plain solo game), the rewards stand alone in the middle. */}
      <div
        className={clsx(
          'mt-10 grid grid-cols-[minmax(0,1fr)] gap-4',
          // Cards keep their own height: stretched to the tallest one, the rewards card would end in an empty block.
          sideCards ? 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-start' : 'mx-auto max-w-2xl',
          !rewardsCard && !sideCards && 'hidden',
        )}
      >
        {!rewardsCard ? null : rewards ? (
          <RewardsCard rewards={rewards} />
        ) : (
          <Card className="p-6 text-sm text-fg-3">Наградите от този мач не можаха да се запишат.</Card>
        )}
        {sideCards && (
          <div className="space-y-4">
            {rewards.daily && (
              <DailyCard daily={rewards.daily} history={game.history} total={game.start.totalQuestions} />
            )}
            {rewards.achievements.length > 0 && <AchievementsCard ids={rewards.achievements} />}
            {rewards.unlocks.length > 0 && <UnlocksCard rewards={rewards} />}
            {rewards.rating && <RatingCard rating={rewards.rating} />}
            {unrated && <UnratedCard reason={unrated} guest={guest} />}
          </div>
        )}
      </div>

      <GuestNudge className="mt-4">
        {rewards
          ? `Запази тези ${fmt(rewards.xpGained)} XP: с име и парола нивото, серията и всичко изиграно остават твои — на всяко устройство.`
          : undefined}
      </GuestNudge>

      {game.history.length > 0 && <QuestionReview items={game.history} />}

      {/* Phones: the next step stays in reach at the bottom while the rewards and the review scroll by — and so does a
          rematch offer, which can arrive at any moment. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-10 border-t border-line bg-ink/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        {rematch && <RematchStrip rematch={rematch} bar className="mb-3 sm:hidden" />}
        <div className="flex gap-2 sm:flex-wrap sm:justify-center sm:gap-3">
          {daily ? (
            // One attempt a day — no "play again".
            <Button size="lg" className="min-w-0 flex-1 sm:flex-none" onClick={dailyBoard}>
              <ChartColumn className="size-5" /> Класиране за деня
            </Button>
          ) : challenge && guest ? (
            // A link plays once and guests can't make their own: home is the way on.
            <Button size="lg" className="min-w-0 flex-1 sm:flex-none" onClick={home}>
              <Home className="size-5" /> Към началото
            </Button>
          ) : (
            <Button size="lg" className="min-w-0 flex-1 sm:flex-none" onClick={again} loading={busy}>
              {challenge ? (
                <>
                  <Swords className="size-5" />
                  <span className="sm:hidden">Предизвикай</span>
                  <span className="max-sm:hidden">Ново предизвикателство</span>
                </>
              ) : end.mode === 'custom' ? (
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
          {!(challenge && guest) && (
            <Button size="lg" variant="secondary" onClick={home}>
              <Home className="size-5" />
              <span className="max-sm:sr-only">{daily ? 'Към началото' : 'Начало'}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A challenge link's result, where a match would show its podium: your place among everyone who played the link, and
 * the link to pass on. The first to finish it (usually whoever made it) sets the score the others chase.
 */
function ChallengeStanding({
  challenge,
  score,
  questions,
  onBoard,
}: {
  challenge: NonNullable<MatchRewards['challenge']>;
  score: number;
  questions: number;
  onBoard: () => void;
}) {
  const first = challenge.total <= 1;
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 180, damping: 20 }}
      className="mx-auto mt-8 max-w-xl"
    >
      <Card className="relative overflow-hidden p-6 text-center sm:p-7">
        <div
          aria-hidden
          className="absolute -top-20 left-1/2 size-56 -translate-x-1/2 rounded-full bg-indigo-400/20 blur-3xl"
        />
        {first ? (
          <>
            <h2 className="relative t-card">Сега прати линка</h2>
            <p className="relative mx-auto mt-2 max-w-sm text-sm text-fg-2">
              Всеки, който го отвори, играе същите {questions} въпроса веднъж, без жокери. Линкът важи 7 дни.
            </p>
          </>
        ) : (
          <>
            <h2 className="sr-only">Класиране по линка</h2>
            <div className="relative flex items-baseline justify-center gap-2">
              <span
                className={clsx(
                  'font-display text-5xl font-black',
                  challenge.rank === 1 ? 'text-amber-300' : 'text-indigo-300',
                )}
              >
                #{challenge.rank}
              </span>
              <span className="text-fg-2">от {plural(challenge.total, 'играч', 'играчи')}</span>
            </div>
            <p className="relative mt-2 text-xs text-fg-3">Класирането се променя, докато другите играят линка.</p>
          </>
        )}
        <div className="relative mt-5 grid gap-2 sm:flex sm:justify-center sm:gap-3">
          <Button onClick={() => shareText(challengeShareText(challenge.id, score, questions), 'Линкът е копиран')}>
            <Share2 className="size-4" /> Сподели линка
          </Button>
          <Button variant="secondary" onClick={onBoard}>
            <ChartColumn className="size-4" /> Виж класирането
          </Button>
        </div>
      </Card>
    </motion.section>
  );
}

/** The chip PlayerTag shows for bots, for the podium (which doesn't use PlayerTag). */
function BotTag() {
  return (
    <span className="shrink-0 rounded-md bg-white/10 px-1 py-px text-[10px] font-bold tracking-wide text-fg-3">
      БОТ
    </span>
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
      <div className="flex items-end justify-center gap-2 sm:gap-6">
        {order.map((s) => {
          const p = game.players[s.id];
          const me = s.id === game.start.youId;
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + (3 - s.placement) * 0.2, type: 'spring', stiffness: 180, damping: 18 }}
              className="flex w-0 max-w-40 min-w-0 flex-1 flex-col items-center"
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
              <Avatar avatar={p.avatar} frame={p.frame} size={s.placement === 1 ? 84 : 68} dim={s.left} />
              <div
                className={clsx(
                  'mt-2 flex max-w-full items-center gap-1 text-sm font-semibold',
                  me && 'text-violet-300',
                )}
              >
                <span className="truncate">{p.name}</span>
                <LevelBadge level={p.level} />
              </div>
              {/* The bot chip goes on the score line: next to the name it would cut the name to a few letters. */}
              <div className="flex items-center gap-1.5 text-xs text-fg-3 tabular-nums">
                {s.left ? 'напусна' : `${fmt(s.score)} т.`}
                {p.isBot && <BotTag />}
              </div>
              <FriendButton player={p} youId={game.start.youId} compact={top.length > 2} className="mt-1.5" />
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
                className={clsx(
                  'flex items-center gap-2 rounded-2xl px-3 py-2 sm:gap-3',
                  s.id === game.start.youId && 'bg-violet-500/12',
                )}
              >
                <span className="w-10 shrink-0 text-sm font-bold whitespace-nowrap text-fg-3">
                  {ordinal(s.placement)}
                </span>
                <Avatar avatar={p.avatar} frame={p.frame} size={34} dim={s.left} />
                <div className="min-w-0 flex-1 text-sm">
                  <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
                </div>
                <FriendButton player={p} youId={game.start.youId} compact />
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
    <section className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {([0, 1] as TeamId[]).map((team) => {
        const color = teamColor(team);
        const won = team === winner;
        const total = scores.find((x) => x.team === team)?.score ?? 0;
        const members = end.standings
          .filter((s) => game.players[s.id]?.team === team)
          .sort((a, b) => b.score - a.score);
        return (
          <motion.div
            key={team}
            initial={{ opacity: 0, x: team === 0 ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + team * 0.12, type: 'spring', stiffness: 180, damping: 20 }}
          >
            <Card
              className={clsx('relative h-full overflow-hidden p-5', !won && 'opacity-85')}
              style={{
                borderColor: won ? `${color}99` : `${color}33`,
                boxShadow: won ? `0 0 48px -16px ${color}` : undefined,
              }}
            >
              <div
                className="absolute -top-16 -right-10 size-48 rounded-full opacity-25 blur-3xl"
                style={{ background: color }}
              />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="t-card" style={{ color }}>
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
                      className={clsx(
                        'flex items-center gap-2 rounded-2xl px-2 py-2 sm:gap-3',
                        s.id === game.start.youId && 'bg-violet-500/12',
                      )}
                    >
                      <Avatar avatar={p.avatar} frame={p.frame} size={36} dim={s.left} />
                      <div className="min-w-0 flex-1 text-sm">
                        <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
                      </div>
                      <FriendButton player={p} youId={game.start.youId} compact />
                      <span className="text-sm font-semibold text-fg-2 tabular-nums">
                        {s.left ? 'напусна' : fmt(s.score)}
                      </span>
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

/** The day's standing and streak. The way to the full board is the main button in the action bar below. */
function DailyCard({
  daily,
  history,
  total,
}: {
  daily: NonNullable<MatchRewards['daily']>;
  history: ReviewItem[];
  total: number;
}) {
  const text = dailyShareText(history, total, daily.streak);
  useEffect(() => rememberDailyShare(text), [text]);
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute -top-16 -right-12 size-48 rounded-full bg-amber-400/25 blur-3xl" />
      <h2 className="relative t-card">Твоето място днес</h2>
      <div className="relative mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl font-black text-amber-300">#{daily.rank}</span>
        <span className="text-fg-2">от {fmt(daily.total)} днес</span>
      </div>
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
        <Button size="sm" onClick={() => shareText(text)}>
          <Share2 className="size-4" /> Сподели резултата
        </Button>
      </div>
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
        {rewards.breakdown.map((line, i) => (
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

function UnlocksCard({ rewards }: { rewards: MatchRewards }) {
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
function UnratedCard({ reason, guest }: { reason: Exclude<UnratedReason, 'no_contest'>; guest: boolean }) {
  return (
    <Card className="p-6">
      <h2 className="t-card">Рейтинг</h2>
      <p className="mt-2 text-sm text-fg-2">
        {reason === 'pair'
          ? `Двамата вече изиграхте ${RATED_GAMES_PER_PAIR} мача с рейтинг днес — до утре мачовете ви са без рейтинг.`
          : guest
            ? 'Като гост играеш срещу хора без рейтинг (срещу ботове — с рейтинг). Запази профила си, за да се класираш.'
            : 'Мачовете срещу гости са без рейтинг.'}
      </p>
    </Card>
  );
}

function RatingCard({ rating }: { rating: { before: number; after: number } }) {
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
