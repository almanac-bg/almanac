import type { Effect } from '@almanac/client';
import * as Haptics from 'expo-haptics';

/**
 * Felt, not heard (the web's buzz map, main.tsx): a tap for your pick, a success for right, an error for wrong, a heavy
 * thud for being knocked out. The phone's own setting for system haptics turns them off.
 */
const HAPTICS: Partial<Record<Effect, () => Promise<void>>> = {
  lock: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  correct: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  wrong: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  timeUp: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  knockedOut: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
};

export const feel = (name: Effect) => void HAPTICS[name]?.().catch(() => {});
