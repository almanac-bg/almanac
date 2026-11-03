import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { radius, useColors } from '@/theme';

/** A card on the home screen: the web's .glass, in the theme's colours. */
export function Card({ children, style, accent }: { children: ReactNode; style?: ViewStyle; accent?: string }) {
  const colors = useColors();
  return (
    <View
      style={[
        {
          gap: 10,
          padding: 18,
          borderRadius: radius.xl,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: accent ? `${accent}55` : colors.line,
          backgroundColor: colors.glass,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
