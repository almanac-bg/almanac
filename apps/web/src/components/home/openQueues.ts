import { useStore } from '@quiz/client';
import { ACHIEVEMENTS, DEFAULT_OPEN_QUEUES, QUEUE_MODES, type QueueModeId } from '@quiz/shared';
import { useMemo } from 'react';

/**
 * The ranked queues the server has open, in the usual order — the defaults until the first lobby stats arrive.
 * Selected as a string, so the stats coming in every few seconds don't re-render a page whose queues didn't change.
 */
export function useOpenQueues(): QueueModeId[] {
  const key = useStore((s) => (s.lobby?.modes ?? DEFAULT_OPEN_QUEUES).join(','));
  return useMemo(() => {
    const open = key.split(',');
    return QUEUE_MODES.filter((m) => open.includes(m));
  }, [key]);
}

/**
 * The achievements on offer: one only a closed ranked queue can award isn't — unless it was earned while that queue was
 * open. The profile and the achievements page count the same set.
 */
export function availableAchievements(open: QueueModeId[], earned: (id: string) => boolean) {
  return ACHIEVEMENTS.filter((a) => !a.queue || (open as string[]).includes(a.queue) || earned(a.id));
}
