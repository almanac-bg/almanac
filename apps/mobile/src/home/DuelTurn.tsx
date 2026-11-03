import { fmt } from '@almanac/client';
import { View } from 'react-native';
import { useDuels, usePlayDuel } from '@/duels/parts';
import { fonts, radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

/** A friend duel waiting for you: at the top of Играй, a tap from playing it (the first of them, if there are more). */
export function DuelTurn() {
  const colors = useColors();
  const { data } = useDuels();
  const { playing, play } = usePlayDuel();
  const yours = (data?.duels ?? []).filter((d) => d.state === 'yours');
  const [first] = yours;
  if (!first) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: `${colors.gold}55`,
        backgroundColor: `${colors.gold}14`,
      }}
    >
      <T style={{ fontSize: 22, lineHeight: 28 }}>⚔️</T>
      <T variant="small" style={{ flex: 1 }}>
        <T variant="small" style={{ fontFamily: fonts.bold }}>
          {first.friend.username}
        </T>{' '}
        те предизвика на дуел
        {first.theirs ? (
          <T variant="small" tone="fg2">
            {' '}
            · {fmt(first.theirs.score)} т. за биене
          </T>
        ) : null}
        {yours.length > 1 ? (
          <T variant="small" tone="fg3">
            {' '}
            (и още {yours.length - 1})
          </T>
        ) : null}
      </T>
      <Button title="Играй" loading={playing === first.id} onPress={() => void play(first.id)} />
    </View>
  );
}
