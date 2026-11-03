import { Stack } from 'expo-router';
import { useHeader } from '@/ui';

/**
 * Знания's own stack, in its tab: the overview, then a category's facts over it with the phone's header and its way
 * back (the swipe from the edge, the arrow, Android's back) — the tab bar stays.
 */
export default function KnowledgeLayout() {
  const header = useHeader();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[category]" />
    </Stack>
  );
}
