import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
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
