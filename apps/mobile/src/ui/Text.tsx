import type { ComponentRef, Ref } from 'react';
import { Text as RNText, StyleSheet, type TextProps, type TextStyle, View, type ViewStyle } from 'react-native';
import { fonts, useColors } from '@/theme';

export type TextVariant = 'hero' | 'h1' | 'h2' | 'title' | 'body' | 'bodyStrong' | 'small' | 'caption' | 'label';

const VARIANTS: Record<TextVariant, TextStyle> = {
  hero: { fontFamily: fonts.displayHeavy, fontSize: 32, lineHeight: 40 },
  h1: { fontFamily: fonts.display, fontSize: 24, lineHeight: 31 },
  h2: { fontFamily: fonts.display, fontSize: 19, lineHeight: 25 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 23 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, letterSpacing: 1, textTransform: 'uppercase' },
};

export interface TProps extends TextProps {
  ref?: Ref<ComponentRef<typeof RNText>>;
  variant?: TextVariant;
  tone?: 'fg' | 'fg2' | 'fg3' | 'link' | 'bad' | 'good' | 'gold';
  align?: TextStyle['textAlign'];
}

/**
 * Every piece of text in the app. It grows with the phone's text size, without a cap: a layout makes room for it (the
 * 31 October review, MOBILE-13) — only the match clock's digits keep to their box.
 */
export function T({ variant = 'body', tone = 'fg', align, style, ...props }: TProps) {
  const colors = useColors();
  return <RNText {...props} style={[VARIANTS[variant], { color: colors[tone], textAlign: align }, style]} />;
}

/**
 * An icon (an emoji) and the words after it, side by side, each a text of its own. On Android one text of both lost
 * its words once the app had drawn that text before: the ⚽ stayed and „Спорт“ went, from the second question of a
 * match on (a symbol from the old range, U+26BD; the first run on a phone, 4 November 2026). Apart, both are drawn
 * every time. A screen reader hears the words only; `containerStyle` is the row's (flex: 1 in a row of its own).
 */
export function IconText({
  icon,
  children,
  align,
  containerStyle,
  ...props
}: TProps & { icon?: string | null; containerStyle?: ViewStyle }) {
  if (!icon)
    return (
      <T align={align} {...props}>
        {children}
      </T>
    );
  const { variant = 'body', tone, style } = props;
  // About a space's width at the text's own size.
  const size = StyleSheet.flatten([VARIANTS[variant], style])?.fontSize ?? 16;
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Math.round(size * 0.3),
          justifyContent: align === 'center' ? 'center' : undefined,
        },
        containerStyle,
      ]}
    >
      <T variant={variant} tone={tone} style={style} accessibilityElementsHidden importantForAccessibility="no">
        {icon}
      </T>
      <T align={align} {...props} style={[{ flexShrink: 1 }, style]}>
        {children}
      </T>
    </View>
  );
}
