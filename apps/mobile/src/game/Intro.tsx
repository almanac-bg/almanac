import { type LiveGame, useNow } from '@almanac/client';
import { MODES } from '@almanac/shared';
import { useEffect } from 'react';
import { View } from 'react-native';
import { play } from '@/lib/sounds';
import { T } from '@/ui';

/** Before the first question: which match it is, who's in it, and the seconds to go. */
export function Intro({ game }: { game: LiveGame }) {
  const now = useNow(200);
  const secs = Math.max(0, Math.ceil((game.countdownEndsAt - now) / 1000));
  const mode = MODES[game.start.mode];
  // Each second counted, then the start.
  useEffect(() => {
    play(secs > 0 ? 'countdown' : 'go');
  }, [secs]);
  const others = game.start.players.filter((p) => p.id !== game.start.youId);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <T variant="label" tone="fg3">
        {mode.name}
      </T>
      <T variant="hero" accessibilityLiveRegion="polite" accessibilityLabel={`Започва след ${secs}`}>
        {secs || 'Старт!'}
      </T>
      {others.length > 0 && (
        <T tone="fg2" align="center">
          срещу {others.map((p) => p.name).join(', ')}
        </T>
      )}
      <T variant="small" tone="fg3" align="center">
        {game.start.totalQuestions} въпроса
        {game.start.pace === 'untimed' ? ' · без часовник' : ` · ${Math.round(game.start.timeMs / 1000)} с за въпрос`}
      </T>
    </View>
  );
}
