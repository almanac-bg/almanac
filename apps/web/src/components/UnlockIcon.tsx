import { unlockPreview, useStore } from '@almanac/client';
import { AVATARS, type UnlockRef } from '@almanac/shared';
import { Avatar } from './Avatar';
import { Emoji } from './Emoji';

/**
 * What an unlock looks like, small: a frame as your own avatar in it (a red ⭕ said nothing of „Мента“), the rest by
 * their art. Decorative: the name goes beside it.
 */
export function UnlockIcon({ unlock, size }: { unlock: UnlockRef; size: number }) {
  const avatar = useStore((s) => s.me?.avatar) ?? AVATARS[0].id;
  if (unlock.kind === 'frame')
    return (
      <span aria-hidden className="inline-flex shrink-0">
        <Avatar avatar={avatar} frame={unlock.id} size={size} />
      </span>
    );
  return <Emoji e={unlockPreview(unlock).icon} size={size} />;
}
