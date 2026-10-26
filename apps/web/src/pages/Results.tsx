import { actions, fmt, getState, type LiveGame, ordinal, toast, useStore } from '@quiz/client';
import { categoryById, isQueueMode, MODES, TEAMS } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, ChartColumn, Home, RotateCcw, Share2, Skull, Swords } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { GuestNudge } from '../components/ClaimAccount';
import { QuestionReview } from '../components/game/QuestionReview';
import { teamColor } from '../components/game/teams';
import { burst } from '../components/results/confetti';
import { FriendsProvider } from '../components/results/FriendButton';
import { RematchStrip, useRematch } from '../components/results/Rematch';
import {
  AchievementsCard,
  DailyCard,
  RatingCard,
  RewardsCard,
  UnlocksCard,
  UnratedCard,
} from '../components/results/ResultCards';
import { ChallengeStanding, Podium, TeamResult } from '../components/results/Standings';
import { Button, Card } from '../components/ui';
import { matchShareText, shareText } from '../lib/share';
import { sfx } from '../lib/sound';

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
  // Everyone else walked out (after the match got going, or it would be no contest). A link is played alone: its win
  // is a place on the board, never a walkout.
  const byWalkout = won && !single && !teamScores && end.standings.every((s) => s.id === youId || s.left);
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
  const share = () =>
    shareText(
      matchShareText({
        modeName: MODES[end.mode].name,
        category: solo ? (categoryById(game.start.category)?.name ?? null) : null,
        place: mine.placement,
        players: end.standings.length,
        won,
        teams: !!teamScores,
        royale: end.mode === 'royale',
        score: mine.score,
        history: game.history,
        total: game.start.totalQuestions,
        levelUp: rewards && rewards.levelAfter > rewards.levelBefore ? rewards.levelAfter : null,
      }),
    );
  const linkBoard = (id: string) => navigate(`/c/${id}`);

  const category = categoryById(game.start.category);
  const headline = end.noContest
    ? rivals
    : daily
      ? perfect
        ? 'Перфектен ден!'
        : 'Днешното е изиграно'
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
            : 'Готово!'
          : teamScores
            ? won
              ? 'Победа!'
              : 'Загуба'
            : won
              ? 'Победа!'
              : // Second of two is a loss, and says so (the rating below says it anyway).
                end.standings.length === 2
                ? 'Загуба'
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
            // A match nobody finished isn't a moment to celebrate: a quieter size for it.
            end.noContest
              ? 'text-[clamp(1.75rem,6vw,3rem)]'
              : longWord
                ? 'text-[clamp(1.75rem,8.5vw,4.5rem)]'
                : 'text-[clamp(2.25rem,7vw,4.5rem)]',
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
          {/* The daily and a challenge link share from their own cards (with the board and the link). */}
          {!daily && !challenge && !end.noContest && (
            <Button size="lg" variant="secondary" onClick={share} aria-label="Сподели резултата">
              <Share2 className="size-5" />
              <span className="max-sm:hidden">Сподели</span>
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
