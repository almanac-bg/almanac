import { avatarEmoji, frameById } from '@almanac/shared';
import { View } from 'react-native';
import { useColors } from '@/theme';
import { T } from './Text';

/**
 * A player's avatar in their frame (the web's Avatar): the frame's gradient as a ring, the emoji on a soft disc inside.
 * `dim`: someone who left.
 */
export function Avatar({
  avatar,
  frame,
  size = 48,
  dim = false,
}: {
  avatar: string;
  frame: string;
  size?: number;
  dim?: boolean;
}) {
  const colors = useColors();
  const f = frameById(frame);
  const ring = Math.max(2, Math.round(size * 0.07));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        padding: ring,
        opacity: dim ? 0.4 : 1,
        experimental_backgroundImage: f.background,
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.avatarLo,
          experimental_backgroundImage: `radial-gradient(circle at 30% 25%, ${colors.avatarHi}, ${colors.avatarLo} 70%)`,
        }}
      >
        <T style={{ fontSize: Math.round(size * 0.55), lineHeight: Math.round(size * 0.7) }}>{avatarEmoji(avatar)}</T>
      </View>
    </View>
  );
}
