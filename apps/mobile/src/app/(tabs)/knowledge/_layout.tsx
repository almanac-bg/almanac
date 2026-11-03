import { Stack } from 'expo-router';
import { fonts, useColors } from '@/theme';

/**
 * Знания's own stack, in its tab: the overview, then a category's facts over it with the phone's header and its way
 * back (the swipe from the edge, the arrow, Android's back) — the tab bar stays.
 */
export default function KnowledgeLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: colors.ink },
        headerStyle: { backgroundColor: colors.ink },
        headerTintColor: colors.fg,
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.fg },
        headerShadowVisible: false,
        headerBackTitle: 'Знания',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[category]" />
    </Stack>
  );
}
