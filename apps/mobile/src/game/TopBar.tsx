import { fmt, type LiveGame } from '@almanac/client';
import { MODES } from '@almanac/shared';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gutter, useColors } from '@/theme';
import { T } from '@/ui';

/** Over the match: the way out, which match and question it is, and your score. */
export function TopBar({ game, onLeave }: { game: LiveGame; onLeave: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const me = game.standings.find((s) => s.id === game.start.youId);
  const q = game.question;
  return (
    <View
      style={{
        paddingTop: insets.top + 6,
        paddingBottom: 10,
        paddingHorizontal: gutter,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      <Pressable
        onPress={onLeave}
        accessibilityRole="button"
        accessibilityLabel="Напусни мача"
        hitSlop={8}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}
      >
        <T variant="h2" tone="fg2">
          ✕
        </T>
      </Pressable>
      <View style={{ flex: 1 }}>
        <T variant="label" tone="fg3">
          {MODES[game.start.mode].name}
        </T>
        {q && (
          <T variant="small" tone="fg2">
            Въпрос {q.index + 1} от {q.total}
          </T>
        )}
      </View>
      <T variant="h2" accessibilityLabel={`${fmt(me?.score ?? 0)} точки`} style={{ fontVariant: ['tabular-nums'] }}>
        {fmt(me?.score ?? 0)}
      </T>
    </View>
  );
}
