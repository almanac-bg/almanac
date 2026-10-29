import { actions, fmt, getState, type LiveGame, ordinal, toast, useStore } from '@quiz/client';
import { categoryById, isQueueMode, MODES, REVIEW, TEAMS } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, BookOpen, ChartColumn, Home, RotateCcw, Share2, Skull, Swords } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { GuestNudge } from '../components/ClaimAccount';
import { DuelCard, RematchButton } from '../components/duels';
import { Emoji } from '../components/Emoji';
import { accentText } from '../components/game/answers';
import { QuestionReview } from '../components/game/QuestionReview';
import { teamColor } from '../components/game/teams';
import { burst } from '../components/results/confetti';
import { FriendsProvider } from '../components/results/FriendButton';
import { LearnedToday } from '../components/results/LearnedToday';
import { RematchStrip, useRematch } from '../components/results/Rematch';
import {
  AchievementsCard,
  DailyCard,
  MasteryCard,
  RatingCard,
  RatingChip,
  RewardsCard,
  UnlockReveal,
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
  const me = useStore((s) => s.me);
  const [busy, setBusy] = useState(false);
  const youId = game.start.youId;
  const mine = end.standings.find((s) => s.id === youId)!;
  const solo = end.mode === 'solo';
  const daily = end.mode === 'daily';
  const challenge = end.mode === 'challenge';
  const review = end.mode === 'review';
  // More missed questions back already: another „Поправителен“; else the almanac they went into.
  const moreReview = review && (me?.almanac.due ?? 0) >= REVIEW.min;
  const single = game.start.players.length === 1;
  const teamScores = end.teamScores;
  const winningTeam = teamScores?.[0].team ?? null;
  const rewards = end.rewards;
  // A challenge link is played alone, but it has a board: first place over others is a win too. A friend duel is won
  // once the friend has played it too.
  const link = rewards?.challenge ?? null;
  const duel = link?.duel ?? null;
  const won =
    (!single && mine.placement === 1 && !end.noContest) ||
    (!!link && !duel && link.rank === 1 && link.total > 1) ||
    duel?.outcome === 'won';
  // Everyone else walked out (after the match got going, or it would be no contest). A link is played alone: its win
  // is a place on the board, never a walkout.
  const byWalkout = won && !single && !teamScores && end.standings.every((s) => s.id === youId || s.left);
  const rivals = end.standings.length > 2 ? 'Съперниците напуснаха' : 'Съперникът напусна';
  const perfect = mine.correct === game.start.totalQuestions;
  // Beaten on a link's board (or by the friend, in a duel): played alone, but lost all the same.
  const lostLink = !!link && (duel ? duel.outcome === 'lost' : link.rank > 1);
  // Lost to other people: no fanfare (a level gained along the way still says so, quietly).
  const lost = (!single && !won && !end.noContest) || lostLink;
  const best = rewards?.soloBest ?? null;
  const newBest = best !== null && best > 0 && mine.score > best;
  // A no contest says so in the headline; the other reasons a rating stayed put get a card.
  const unrated = rewards?.unrated && rewards.unrated !== 'no_contest' ? rewards.unrated : null;
  // A no contest has no podium to show, and nothing to award unless a question or two were answered.
  const rewardsCard = !end.noContest || (!!rewards && rewards.xpGained > 0);
  const sideCards =
    !!rewards &&
    (!!rewards.daily ||
      rewards.achievements.length > 0 ||
      rewards.unlocks.length > 0 ||
      !!rewards.mastery?.length ||
      !!rewards.rating ||
      !!unrated);
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
    if (won || (single && perfect && !lostLink) || newBest) {
      sfx.win();
      burst(1.2);
    }
  }, [won, single, perfect, newBest, lostLink]);

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
    if (mode === 'review') {
      if (!moreReview) {
        navigate('/almanac');
        return;
      }
      setBusy(true);
      const res = await actions.startReview();
      setBusy(false);
      if (!res.ok) toast({ kind: 'error', title: res.error });
      return;
    }
    // Отбори starts from a friend's yes (or „Реванш“ with the same pair): home, where its card asks who with. The
    // evening Роял is once a day: home too.
    if (MODES[mode].teams || mode === 'evening') {
      home();
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
  async function playDuel() {
    actions.closeGame();
    navigate('/');
    const res = await actions.joinQueue('duel');
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }
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
        : 'Денят е изигран'
      : duel
        ? duel.outcome
          ? { won: 'Победа!', lost: 'Загуба', draw: 'Равенство' }[duel.outcome]
          : 'Ходът ти е изигран'
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
      <m.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
        <p className="t-eyebrow text-fg-3">
          {duel ? `Дуел с ${duel.friend.username}` : MODES[end.mode].name}
          {solo && category && ` · ${category.name}`}
        </p>
        <m.h1
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
              : lost
                ? 'text-fg'
                : 'text-gradient',
          )}
        >
          {headline}
        </m.h1>
        {winningTeam !== null && (
          <m.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-3 font-display text-xl font-bold"
            style={{ color: accentText(teamColor(winningTeam)), textShadow: `0 0 24px ${teamColor(winningTeam)}88` }}
          >
            {TEAMS[winningTeam].name} печелят!
          </m.p>
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
        {/* What changed, before anything else: the rating, the record to beat, the XP. */}
        {rewards && !end.noContest && (
          <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm font-semibold">
            {rewards.rating && <RatingChip rating={rewards.rating} />}
            {best !== null && (
              <span
                className={clsx(
                  'rounded-full px-3 py-1',
                  newBest ? 'bg-amber-400/15 text-amber-200' : 'bg-tint/5 text-fg-2',
                )}
              >
                {newBest ? (
                  <>
                    <Emoji e="🏆" /> Нов личен рекорд! (беше {fmt(best)})
                  </>
                ) : best === 0 ? (
                  `Рекорд за побиване: ${fmt(mine.score)}`
                ) : (
                  `Личен рекорд: ${fmt(best)}`
                )}
              </span>
            )}
            {end.mode === 'evening' && mine.placement === 1 && (
              <span className="rounded-full bg-indigo-400/15 px-3 py-1 text-indigo-100">
                <Emoji e="🌙" /> Шампион на вечерта — титлата е твоя за денонощие
              </span>
            )}
            {/* A guest has it in the card that offers to keep it, right below. */}
            {rewards.xpGained > 0 && !guest && (
              <span className="rounded-full bg-violet-500/15 px-3 py-1 text-violet-200">
                +{fmt(rewards.xpGained)} XP
              </span>
            )}
          </div>
        )}
        {(end.noContest || byWalkout) && (
          <p className={clsx('mx-auto max-w-md text-fg-3', end.noContest ? 'mt-4' : 'mt-2 text-sm')}>
            {end.noContest
              ? 'Още в началото, затова мачът не се зачита: без победа и без промяна в рейтинга.'
              : `${rivals} по време на мача — победата е твоя.`}
          </p>
        )}
      </m.header>

      {/* A guest's first results: what keeps them comes first, not after the rewards. */}
      <GuestNudge className="mx-auto mt-6 max-w-2xl">
        {rewards
          ? `Запази тези ${fmt(rewards.xpGained)} XP: с име и парола нивото, серията и всичко изиграно остават твои — на всяко устройство.`
          : undefined}
      </GuestNudge>

      {/* The standings offer "+ Приятел" beside each person you played with. */}
      <FriendsProvider game={game}>
        {teamScores ? (
          <TeamResult game={game} end={end} />
        ) : (
          !single && !end.noContest && <Podium game={game} standings={end.standings} />
        )}
      </FriendsProvider>
      {duel && me && <DuelCard standing={duel} me={me} actions={false} className="mx-auto mt-8 max-w-md" />}
      {link && !duel && (
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
          <div className="space-y-4">
            <UnlockReveal rewards={rewards} />
            <RewardsCard rewards={rewards} quiet={lost} />
          </div>
        ) : (
          <Card className="p-6 text-sm text-fg-3">Наградите от този мач не можаха да се запишат.</Card>
        )}
        {sideCards && (
          <div className="space-y-4">
            {rewards.daily && (
              <DailyCard
                daily={rewards.daily}
                history={game.history}
                total={game.start.totalQuestions}
                score={mine.score}
              />
            )}
            {rewards.achievements.length > 0 && <AchievementsCard ids={rewards.achievements} />}
            {!!rewards.mastery?.length && <MasteryCard mastery={rewards.mastery} />}
            {rewards.unlocks.length > 0 && <UnlocksCard rewards={rewards} />}
            {rewards.rating && <RatingCard rating={rewards.rating} />}
            {unrated && <UnratedCard reason={unrated} guest={guest} />}
          </div>
        )}
      </div>

      <LearnedToday items={game.history} added={rewards?.almanac?.added ?? 0} />
      {game.history.length > 0 && <QuestionReview items={game.history} />}

      {/* The next step stays in reach at the bottom while the rewards and the review scroll by — and on phones so does a
          rematch offer, which can arrive at any moment. Wider screens: a floating bar in the middle. */}
      <div className="sticky bottom-0 z-30 -mx-4 mt-10 cramped:static border-t border-line bg-ink/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:bottom-5 sm:mx-auto sm:w-fit sm:rounded-2xl sm:border sm:px-3 sm:py-3">
        {rematch && <RematchStrip rematch={rematch} bar className="mb-3 sm:hidden" />}
        <div className="flex gap-2 sm:flex-wrap sm:justify-center sm:gap-3">
          {daily && rewards?.daily?.offBoard ? (
            // A newcomer's first day (off the board until tomorrow): a duel is the next thing to try.
            <Button
              size="lg"
              className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none"
              onClick={() => void playDuel()}
            >
              <Swords className="size-5" /> Играй Дуел
            </Button>
          ) : daily ? (
            // One attempt a day — no "play again".
            <Button
              size="lg"
              className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none"
              onClick={dailyBoard}
            >
              <ChartColumn className="size-5" /> Класиране за деня
            </Button>
          ) : duel ? (
            // A duel plays once: what follows is a rematch, once it's decided; until then, home.
            duel.outcome || duel.expired ? (
              <RematchButton
                standing={duel}
                size="lg"
                className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none"
              />
            ) : (
              <Button size="lg" className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none" onClick={home}>
                <Home className="size-5" /> Към началото
              </Button>
            )
          ) : challenge && guest ? (
            // A link plays once and guests can't make their own: home is the way on.
            <Button size="lg" className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none" onClick={home}>
              <Home className="size-5" /> Към началото
            </Button>
          ) : (
            <Button
              size="lg"
              // After a link, sharing it is the main thing (its card above); a new one is the way on.
              variant={challenge ? 'secondary' : 'primary'}
              className="min-w-0 flex-1 whitespace-nowrap max-sm:px-4 sm:flex-none"
              onClick={again}
              loading={busy}
            >
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
              ) : review && !moreReview ? (
                <>
                  <BookOpen className="size-5" /> Моят алманах
                </>
              ) : (MODES[end.mode].teams && !end.roomCode) || end.mode === 'evening' ? (
                <>
                  <Home className="size-5" /> Към началото
                </>
              ) : (
                <>
                  <RotateCcw className="size-5" /> Играй пак
                </>
              )}
            </Button>
          )}
          {/* The daily and a challenge link share from their own cards (with the board and the link); a review run
              is practice on questions already shown, nothing to show off. */}
          {!daily && !challenge && !review && !end.noContest && (
            <Button
              size="lg"
              variant="secondary"
              className="max-sm:w-14 max-sm:px-0"
              onClick={share}
              aria-label="Сподели резултата"
            >
              <Share2 className="size-5" />
              <span className="max-sm:hidden">Сподели</span>
            </Button>
          )}
          {!(challenge && guest) && !(duel && !duel.outcome && !duel.expired) && (
            <Button size="lg" variant="secondary" className="max-sm:w-14 max-sm:px-0" onClick={home}>
              <Home className="size-5" />
              <span className="max-sm:sr-only">{daily ? 'Към началото' : 'Начало'}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
