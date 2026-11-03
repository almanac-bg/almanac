import { useStore } from '@almanac/client';
import { MORE_TIME } from '@almanac/shared';
import clsx from 'clsx';
import { Timer } from 'lucide-react';

/**
 * Before a run that has a board (the daily, a link, a friend duel), when „Повече време“ is on: its clock, and that the
 * result is off the board — said before the one attempt, not after it (D6). Nothing when it's off.
 */
export function MoreTimeNote({ duel = false, className }: { duel?: boolean; className?: string }) {
  const setting = useStore((s) => s.me?.moreTime ?? 'off');
  if (setting === 'off') return null;
  const label = MORE_TIME.find((m) => m.id === setting)!.label;
  return (
    <p className={clsx('flex items-start gap-1.5 text-xs text-fg-3 text-pretty', className)}>
      <Timer aria-hidden className="mt-px size-3.5 shrink-0 text-violet-300" />
      <span>
        С „Повече време“ ({label === 'Без часовник' ? 'без часовник' : `${label} за въпрос`}){' '}
        {duel ? '— победата важи, но без бонус.' : '— резултатът е извън класацията.'} Промени го в Настройки.
      </span>
    </p>
  );
}
