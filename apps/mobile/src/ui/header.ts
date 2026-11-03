import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { fonts, useColors } from '@/theme';

type ScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack.Screen>['options']>,
  (...args: never[]) => unknown
>;

/**
 * The phone's own header for a page pushed over another (Settings, a player, a category's facts): its title, and the
 * way back — the arrow, the swipe from the edge, Android's back — in the theme's colours.
 */
export function useHeader(title?: string): ScreenOptions {
  const colors = useColors();
  return {
    headerShown: true,
    title,
    headerStyle: { backgroundColor: colors.ink },
    headerTintColor: colors.fg,
    headerTitleStyle: { fontFamily: fonts.bold, color: colors.fg },
    headerBackTitleStyle: { fontFamily: fonts.medium },
    headerShadowVisible: false,
    // The arrow alone, said as „Назад“ (the page before may have no title of its own: the tabs).
    headerBackButtonDisplayMode: 'minimal',
    headerBackTitle: 'Назад',
    contentStyle: { backgroundColor: colors.ink },
  };
}
