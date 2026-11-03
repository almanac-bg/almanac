import { useStore } from '@almanac/client';
import { MORE_TIME } from '@almanac/shared';
import { T } from '@/ui';

/** With „Повече време“ on: what it changes here (a duel's win stands without its bonus; a link's run is off the board). */
export function MoreTimeNote({ duel = false }: { duel?: boolean }) {
  const setting = useStore((s) => s.me?.moreTime ?? 'off');
  if (setting === 'off') return null;
  const label = MORE_TIME.find((m) => m.id === setting)?.label ?? '';
  return (
    <T variant="caption" tone="fg3">
      ⏱ С „Повече време“ ({label === 'Без часовник' ? 'без часовник' : `${label} за въпрос`}){' '}
      {duel ? '— победата важи, но без бонус.' : '— резултатът е извън класацията.'} Промени го в Настройки.
    </T>
  );
}
