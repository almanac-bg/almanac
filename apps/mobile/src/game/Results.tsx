import {
  actions,
  challengeShareText,
  fmt,
  type LiveGame,
  matchOutcome,
  matchShareText,
  rewardSteps,
  toast,
  useStore,
} from '@almanac/client';
import { categoryById, EVENING, isQueueMode, MODES, TEAMS } from '@almanac/shared';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, ScrollView, Share, type Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DuelCard, RematchButton } from '@/duels/parts';
import { API_URL } from '@/lib/client';
import { play } from '@/lib/sounds';
import {
  AchievementsCard,
  Chip,
  DailyResult,
  GuestNudge,
  LearnedToday,
  MasteryCard,
  RatingCard,
  RatingChip,
  RewardsCard,
  UnlockReveal,
  UnlocksCard,
  UnratedCard,
} from '@/results/Cards';
import { QuestionReview } from '@/results/QuestionReview';
import { RematchStrip, useRematch } from '@/results/Rematch';
import { ChallengeStanding, FriendsProvider, Podium, TeamResult } from '@/results/Standings';
import { RewardMoment } from '@/rewards/RewardMoment';
import { fonts, gutter, useColors } from '@/theme';
import { Button, Card, COLUMN, T, usePagePadding } from '@/ui';

/**
 * After the match (the web's Results): how it went — the headline, the rating, the record, the XP — who placed where,
 * the duel or the link it was, what it brought, what was learned, and the questions with their answers. The next step
 * stays at the bottom, in reach, as the rest scrolls by.
 */
export function Results({ game }: { game: LiveGame }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const padding = usePagePadding();
  const room = useStore((s) => s.room);
  const guest = useStore((s) => !!s.me?.isGuest);
  const roomGuest = useStore((s) => !!s.me?.roomGuest);
  const reviewDue = useStore((s) => s.me?.knowledge.due ?? 0);
  const [busy, setBusy] = useState(false);
  const o = matchOutcome(game, { roomGuest, reviewDue });
  const { end, mine, rewards, link, duel, single, teamScores } = o;
  const category = categoryById(game.start.category);
  const headline = useRef<ComponentRef<typeof Text>>(null);
  const rematch = useRematch(game);
  // A new level, a milestone to pick, a new avatar or frame: one beat at a time before the results (RewardMoment).
  const [steps] = useState(() => rewardSteps(end.noContest || o.classPupil ? null : rewards));
  const [moment, setMoment] = useState(steps.length > 0);

  // The outcome is felt (a win, a perfect run, a record) as the results come in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the results come in
  useEffect(() => {
    if (o.fanfare) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      play('win');
    } else if (!single) play('lose');
  }, []);
  // A screen reader starts on the headline — once the reward moment, if there is one, has closed.
  useEffect(() => {
    if (moment) return;
    const node = headline.current && findNodeHandle(headline.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [moment]);

  const home = () => {
    actions.closeGame();
    router.replace('/');
  };
  const run = async (start: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true);
    const res = await start();
    setBusy(false);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  };
  const again = async () => {
    const mode = end.mode;
    if (mode === 'challenge') return run(() => actions.startChallenge());
    if (mode === 'custom') {
      actions.closeGame();
      return router.replace(room ? '/room' : '/');
    }
    if (mode === 'solo') {
      actions.closeGame();
      return run(() => actions.startSolo(game.start.category, game.start.pace === 'untimed' ? 'untimed' : 'normal'));
    }
    if (mode === 'review') {
      if (!o.moreReview) {
        actions.closeGame();
        return router.replace('/knowledge');
      }
      return run(() => actions.startReview());
    }
    if (o.againIsHome) return home();
    if (isQueueMode(mode)) {
      home();
      return run(() => actions.joinQueue(mode));
    }
  };
  const toBoard = () => {
    actions.closeGame();
    router.replace('/leaderboard');
  };
  const playDuel = () => {
    home();
    void run(() => actions.joinQueue('duel'));
  };
  const share = () =>
    void Share.share({
      message: matchShareText({
        modeName: MODES[end.mode].name,
        category: o.solo ? (category?.name ?? null) : null,
        place: mine.placement,
        players: end.standings.length,
        won: o.won,
        teams: !!teamScores,
        royale: end.mode === 'royale',
        score: mine.score,
        history: game.history,
        total: game.start.totalQuestions,
        levelUp: rewards && rewards.levelAfter > rewards.levelBefore ? rewards.levelAfter : null,
      }),
    });

  // A no contest has nothing to award unless a question or two were answered; a class's pupil, nothing as theirs.
  const rewardsCard = !o.classPupil && (!end.noContest || (!!rewards && rewards.xpGained > 0));
  const sideCards = !o.classPupil && !!rewards;
  const eveningChampion = game.start.players.filter((p) => !p.isBot && !p.record).length >= EVENING.titleFrom;
  const shareable = !o.daily && !o.challenge && !o.review && !end.noContest;
  // The main button: what comes next, by the mode.
  const main = o.daily
    ? rewards?.daily?.offBoard
      ? { title: '⚔️ Играй Дуел', onPress: playDuel }
      : { title: '📊 Класация за деня', onPress: toBoard }
    : duel
      ? null
      : o.challenge && guest
        ? { title: 'Към началото', onPress: home }
        : {
            title: o.challenge
              ? '⚔️ Ново предизвикателство'
              : end.mode === 'custom'
                ? 'Обратно в стаята'
                : o.review && !o.moreReview
                  ? '📖 Моите знания'
                  : o.againIsHome
                    ? 'Към началото'
                    : '↻ Играй пак',
            onPress: () => void again(),
          };
  const mainGoesHome = main?.title === 'Към началото' || (!!duel && !duel.outcome && !duel.expired);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <RewardMoment steps={steps} open={moment} onDone={() => setMoment(false)} />
      <ScrollView contentContainerStyle={[padding, { paddingBottom: 24 }]}>
        <View style={[COLUMN, { gap: 16 }]}>
          <View style={{ alignItems: 'center', gap: 8 }}>
            <T variant="label" tone="fg3" align="center">
              {duel ? `Дуел с ${duel.friend.username}` : MODES[end.mode].name}
              {o.solo && category ? ` · ${category.name}` : ''}
            </T>
            <T
              ref={headline}
              variant="hero"
              role="heading"
              align="center"
              style={{
                fontSize: end.noContest ? 26 : 36,
                lineHeight: end.noContest ? 32 : 44,
                color: o.won ? colors.gold : colors.fg,
              }}
            >
              {o.headline}
            </T>
            {o.winningTeam !== null && (
              <T variant="h2" align="center" style={{ color: TEAMS[o.winningTeam].color }}>
                {TEAMS[o.winningTeam].name} печелят!
              </T>
            )}
            {!end.noContest && (
              <T tone="fg2" align="center">
                {mine.eliminatedAt !== null ? (
                  `💀 Отпадна след въпрос ${mine.eliminatedAt}`
                ) : (
                  <>
                    <T style={{ fontFamily: fonts.bold }}>{fmt(mine.score)}</T> точки · {mine.correct} от{' '}
                    {game.start.totalQuestions} верни
                  </>
                )}
              </T>
            )}
            {rewards && !end.noContest && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                {rewards.rating && <RatingChip rating={rewards.rating} />}
                {o.best !== null && (
                  <Chip
                    tone={o.newBest ? 'gold' : 'fg2'}
                    text={
                      o.newBest
                        ? `🏆 Нов личен рекорд! (беше ${fmt(o.best)})`
                        : o.best === 0
                          ? `Рекорд за побиване: ${fmt(mine.score)}`
                          : `Личен рекорд: ${fmt(o.best)}`
                    }
                  />
                )}
                {end.mode === 'evening' && mine.placement === 1 && (
                  <Chip
                    tone="link"
                    text={
                      eveningChampion
                        ? '🌙 Шампион на вечерта — титлата е твоя за денонощие'
                        : `🌙 Първо място. Титлата „Шампион на вечерта“ се печели срещу поне ${EVENING.titleFrom - 1} души`
                    }
                  />
                )}
                {/* A guest has it in the card that offers to keep it, below. */}
                {rewards.xpGained > 0 && !guest && <Chip tone="link" text={`+${fmt(rewards.xpGained)} XP`} />}
              </View>
            )}
            {(end.noContest || o.byWalkout) && (
              <T variant="small" tone="fg3" align="center">
                {end.noContest
                  ? 'Още в началото, затова мачът не се зачита: без победа и без промяна в рейтинга.'
                  : `${o.rivals} по време на мача — победата е твоя.`}
              </T>
            )}
          </View>

          <FriendsProvider game={game}>
            {teamScores ? (
              <TeamResult game={game} end={end} />
            ) : (
              !single && !end.noContest && <Podium game={game} standings={end.standings} />
            )}
          </FriendsProvider>
          {duel && <DuelCard standing={duel} canPlay={false} onPlay={() => {}} playing={false} actions={false} />}
          {link && !duel && (
            <ChallengeStanding
              challenge={link}
              onShare={() =>
                void Share.share({
                  message: challengeShareText(API_URL, link.id, mine.score, game.start.totalQuestions),
                })
              }
            />
          )}

          {sideCards && rewards.daily && (
            <DailyResult
              daily={rewards.daily}
              history={game.history}
              total={game.start.totalQuestions}
              score={mine.score}
            />
          )}
          {rewardsCard &&
            (rewards ? (
              <>
                {/* The reward moment offered the new avatar or frame already („Сложи го“): not a second time here. */}
                {steps.length === 0 && <UnlockReveal rewards={rewards} />}
                <RewardsCard rewards={rewards} />
              </>
            ) : end.saving ? (
              <Card>
                <T variant="small" tone="fg2">
                  Записваме наградите от мача… идват след миг.
                </T>
              </Card>
            ) : (
              <Card>
                <T variant="small" tone="fg3">
                  Наградите от този мач не можаха да се запишат.
                </T>
              </Card>
            ))}
          {sideCards && rewards.achievements.length > 0 && <AchievementsCard ids={rewards.achievements} />}
          {sideCards && !!rewards.mastery?.length && <MasteryCard mastery={rewards.mastery} />}
          {sideCards && rewards.unlocks.length > 0 && <UnlocksCard rewards={rewards} />}
          {sideCards && rewards.rating && <RatingCard rating={rewards.rating} />}
          {sideCards && o.unrated && <UnratedCard reason={o.unrated} guest={guest} />}

          {o.classPupil ? (
            <Card>
              <T variant="small" tone="fg2">
                Влезе като гост за стаята: до час, след като излезеш, профилът и всичко изиграно се изтриват.
              </T>
            </Card>
          ) : (
            guest && <GuestNudge xp={rewards?.xpGained ?? null} />
          )}

          <LearnedToday items={game.history} added={rewards?.knowledge?.added ?? 0} />
          {game.history.length > 0 && (
            <QuestionReview
              items={game.history}
              set={game.start.questionSet ? { gameId: game.start.gameId, name: game.start.questionSet } : null}
            />
          )}
        </View>
      </ScrollView>

      <View
        style={{
          gap: 10,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          paddingLeft: insets.left + gutter,
          paddingRight: insets.right + gutter,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          backgroundColor: colors.ink2,
        }}
      >
        {/* A rematch offer can come at any moment: in reach, over the next step. */}
        {rematch && <RematchStrip rematch={rematch} />}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {duel ? (
            duel.outcome || duel.expired ? (
              <View style={{ flex: 1 }}>
                <RematchButton standing={duel} />
              </View>
            ) : (
              <Button title="Към началото" size="lg" onPress={home} style={{ flex: 1 }} />
            )
          ) : (
            main && (
              <Button
                title={main.title}
                size="lg"
                variant={o.challenge ? 'secondary' : 'primary'}
                loading={busy}
                onPress={main.onPress}
                style={{ flex: 1 }}
              />
            )
          )}
          {shareable && <Button title="↗" label="Сподели резултата" size="lg" variant="secondary" onPress={share} />}
          {!mainGoesHome && <Button title="⌂" label="Към началото" size="lg" variant="secondary" onPress={home} />}
        </View>
      </View>
    </View>
  );
}
