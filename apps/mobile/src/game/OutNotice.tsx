import { actions, type LiveGame, othersStillIn } from '@almanac/client';
import { useState } from 'react';
import { View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

/**
 * Knocked out: the questions go on and can still be answered — for XP and „Моите знания“, outside the race. With only
 * bots left, „Към резултата“ plays their final out at once; outside a room, leaving is no forfeit any more.
 */
export function OutNotice({ game }: { game: LiveGame }) {
  const colors = useColors();
  const [finishing, setFinishing] = useState(false);
  const watching = othersStillIn(game) > 0;
  const freeToGo = !game.start.roomCode;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: 8,
        padding: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: 'rgba(251,113,133,0.3)',
        backgroundColor: colors.ink2,
      }}
    >
      <T variant="small" tone="bad">
        {watching
          ? '💀 Отпадна — отговаряй до края: за XP и знанията, извън класирането'
          : finishing
            ? '💀 Отпадна. Резултатът идва след миг…'
            : '💀 Отпадна. Останаха само ботове'}
      </T>
      {!watching && !finishing && (
        <>
          <T variant="caption" tone="fg2">
            Довърши въпросите в твоето темпо — за XP и знанията — или виж резултата веднага.
          </T>
          <Button
            title="Към резултата"
            variant="secondary"
            onPress={() => {
              setFinishing(true);
              actions.finishOn();
            }}
          />
        </>
      )}
      {freeToGo && watching && (
        <>
          <T variant="caption" tone="fg2">
            Можеш да излезеш — мястото ти се запазва, а наградите идват в края на мача.
          </T>
          <Button title="Излез" variant="secondary" onPress={actions.leaveGame} />
        </>
      )}
    </View>
  );
}
