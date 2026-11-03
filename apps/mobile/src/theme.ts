// The website's design tokens (apps/web/src/styles.css), for both themes: the app follows the phone's (Settings can fix
// one), as the site does.
import { useColorScheme } from 'react-native';

export const palettes = {
  dark: {
    ink: '#07060d',
    ink2: '#0e0c18',
    line: 'rgba(255,255,255,0.08)',
    lineStrong: 'rgba(255,255,255,0.16)',
    glass: 'rgba(255,255,255,0.05)',
    fg: '#f5f3ff',
    fg2: '#b3aed0',
    fg3: '#9c95bd',
    violet: '#8b5cf6',
    link: '#c4b5fd',
    good: '#34d399',
    bad: '#fb7185',
    gold: '#fbbf24',
    onFill: '#07060d',
  },
  light: {
    ink: '#f4f3f9',
    ink2: '#ffffff',
    line: 'rgba(22,19,40,0.12)',
    lineStrong: 'rgba(22,19,40,0.22)',
    glass: 'rgba(22,19,40,0.04)',
    fg: '#16131f',
    fg2: '#4a4462',
    fg3: '#57516f',
    violet: '#7c3aed',
    link: '#6d28d9',
    good: '#047857',
    bad: '#be123c',
    gold: '#b45309',
    onFill: '#ffffff',
  },
} as const;

export type Palette = { [K in keyof (typeof palettes)['dark']]: string };

/** The palette for the phone's theme now. */
export function useColors(): Palette {
  return palettes[useColorScheme() === 'light' ? 'light' : 'dark'];
}

/** The same on both themes, as on the web: the primary button's gradient, the gold one's (with its dark brown text). */
export const fills = {
  primary: 'linear-gradient(110deg, #9333ea, #7c3aed 45%, #db2777)',
  gold: 'linear-gradient(110deg, #fde68a, #f59e0b)',
  goldText: '#451a03',
  danger: '#be123c',
} as const;

/** Loaded in the root layout (src/app/_layout.tsx); the keys are the families' names. */
export const fonts = {
  regular: 'Onest_400Regular',
  medium: 'Onest_500Medium',
  semibold: 'Onest_600SemiBold',
  bold: 'Onest_700Bold',
  /** Unbounded: headlines and numbers, short and bold (its lowercase Cyrillic is its own). */
  display: 'Unbounded_700Bold',
  displayHeavy: 'Unbounded_800ExtraBold',
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28 } as const;
/** The page's side margin. */
export const gutter = 20;
