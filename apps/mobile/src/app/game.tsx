import { actions, type LiveGame, useStore } from '@almanac/client';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Emotes } from '@/game/Emotes';
import { Intro } from '@/game/Intro';
import { OutNotice } from '@/game/OutNotice';
import { QuestionScreen } from '@/game/QuestionScreen';
import { Results } from '@/game/Results';
import { RoundPick } from '@/game/RoundPick';
import { Strip } from '@/game/Strip';
import { TopBar } from '@/game/TopBar';
import { gutter, useColors } from '@/theme';
import { IconText, T } from '@/ui';

/** The match on screen, from its countdown to its results (the web's GamePage). */
export default function GameScreen() {
  const game = useStore((s) => s.game);
  const settled = useStore((s) => s.settled);
  const offline = !useStore((s) => s.connected);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);

  // What leaving costs, said before it happens (and Android's back asks the same, as ✕ does).
  const leave = useCallback(() => {
    if (!game || asking) return;
    const out = game.eliminated.includes(game.start.youId);
    setAsking(true);
    Alert.alert(
      'Да напуснеш ли мача?',
      out
        ? 'Мястото, на което отпадна, се запазва — наградите идват, когато мачът свърши.'
        : game.start.mode === 'daily'
          ? 'Днешният опит ще се зачете с точките досега — нов опит има чак утре.'
          : game.start.ranked
            ? 'Оставаш на последно място и губиш рейтинг.'
            : 'Прогресът от този мач няма да се зачете.',
      [
        { text: 'Остани', style: 'cancel', onPress: () => setAsking(false) },
        {
          text: 'Напусни',
          style: 'destructive',
          onPress: () => {
            setAsking(false);
            actions.leaveGame();
          },
        },
      ],
      { cancelable: true, onDismiss: () => setAsking(false) },
    );
  }, [game, asking]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!game || game.phase === 'ended') return false;
        leave();
        return true;
      });
      return () => sub.remove();
    }, [game, leave]),
  );

  // After a restart mid-match the server sends it again within moments: no trip home meanwhile.
  if (!game)
    return settled ? (
      <Redirect href="/" />
    ) : (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink, gap: 12 }}>
        <ActivityIndicator />
        <T tone="fg2">Връщаме те в мача…</T>
      </View>
    );
  if (game.phase === 'ended' && game.end) return <Results key={game.end.rewards ? 'saved' : 'saving'} game={game} />;
  const single = game.start.players.length === 1;
  const out = game.eliminated.includes(game.start.youId);
  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <TopBar game={game} onLeave={leave} />
      {!single && <Strip game={game} />}
      <Feed game={game} />
      {offline && (
        <T variant="small" tone="bad" align="center" style={{ paddingTop: 8 }} accessibilityLiveRegion="polite">
          Няма връзка — връщаме те веднага щом се появи
        </T>
      )}
      {/* A column on a tablet, as the pages are (COLUMN), a little wider for the question and its picture: across a
          whole iPad the answers were bars 700 wide under an empty middle. On a phone it's the whole width. */}
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 640,
          alignSelf: 'center',
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 16,
        }}
      >
        {game.phase === 'countdown' ? (
          <Intro game={game} />
        ) : game.phase === 'pick' && game.pick ? (
          <RoundPick game={game} />
        ) : game.question ? (
          <QuestionScreen key={`q${game.question.index}`} game={game} offline={offline} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <T tone="fg3">Следващият въпрос идва…</T>
          </View>
        )}
        {out && game.phase !== 'countdown' && <OutNotice game={game} />}
        {!single && <Emotes emotes={game.start.emotes} offline={offline} />}
      </View>
    </View>
  );
}

/** What just happened in the match („Ана отпадна“, a коз played), for a few seconds — and to a screen reader. */
function Feed({ game }: { game: LiveGame }) {
  const last = game.feed.at(-1);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    setShown(last.key);
    const t = setTimeout(() => setShown(null), 4000);
    return () => clearTimeout(t);
  }, [last]);
  if (!last || shown !== last.key) return null;
  return (
    <IconText
      icon={last.icon}
      variant="small"
      tone="fg2"
      align="center"
      accessibilityLiveRegion="polite"
      containerStyle={{ paddingTop: 8 }}
    >
      {last.text}
    </IconText>
  );
}
