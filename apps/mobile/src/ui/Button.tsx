import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, type ViewStyle } from 'react-native';
import { fills, fonts, radius, useColors } from '@/theme';
import { T } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger';
type Size = 'md' | 'lg';

const HEIGHT: Record<Size, number> = { md: 48, lg: 56 };

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  /** What it does, when the title alone doesn't say (VoiceOver, TalkBack). */
  hint?: string;
  style?: ViewStyle;
}

/** The web's buttons (components/ui.tsx): at least 48 points tall, a tap's light tick, a spinner while it works. */
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  hint,
  style,
}: ButtonProps) {
  const colors = useColors();
  const off = disabled || loading;
  const look: Record<Variant, { box: ViewStyle; text: string }> = {
    primary: { box: { experimental_backgroundImage: fills.primary }, text: '#ffffff' },
    secondary: {
      box: { backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.lineStrong },
      text: colors.fg,
    },
    ghost: { box: {}, text: colors.fg2 },
    gold: { box: { experimental_backgroundImage: fills.gold }, text: fills.goldText },
    danger: { box: { backgroundColor: fills.danger }, text: '#ffffff' },
  };
  const { box, text } = look[variant];
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress?.();
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ disabled: off, busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: off && !loading ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        box,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={text} />
      ) : (
        <T style={{ fontFamily: fonts.semibold, fontSize: size === 'lg' ? 17 : 16, color: text }} align="center">
          {title}
        </T>
      )}
    </Pressable>
  );
}
