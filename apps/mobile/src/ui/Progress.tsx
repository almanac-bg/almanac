import { View, type ViewStyle } from 'react-native';
import { radius, useColors } from '@/theme';

/**
 * How far along, as a bar (the web's ProgressBar): `value` from 0 to 1. Said as `label` and `valueText` ("Ниво 4",
 * "120 от 400 XP"); inside a row that says it already, it is part of that row and says nothing itself.
 */
export function Progress({
  value,
  color,
  label,
  valueText,
  height = 8,
  style,
}: {
  value: number;
  color?: string;
  label?: string;
  valueText?: string;
  height?: number;
  style?: ViewStyle;
}) {
  const colors = useColors();
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessible={!!label}
      accessibilityRole={label ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now: pct, text: valueText } : undefined}
      style={[{ height, borderRadius: radius.sm, backgroundColor: colors.ink2, overflow: 'hidden' }, style]}
    >
      <View
        style={{ width: `${pct}%`, height: '100%', borderRadius: radius.sm, backgroundColor: color ?? colors.violet }}
      />
    </View>
  );
}
