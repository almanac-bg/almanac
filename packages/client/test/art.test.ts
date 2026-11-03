// Every emoji the game's data shows has its picture in the art set (apps/web/src/emoji, Fluent 3D): one without falls
// back to the system's glyph, a different drawing on every device (the 31 October review, VD-10).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  ACHIEVEMENTS,
  AVATARS,
  CATEGORIES,
  EMOTES,
  FRAMES,
  MASTERY_TIERS,
  TITLES,
  type UnlockRef,
} from '@almanac/shared';
import { unlockPreview } from '../src/unlocks';

const ART = path.join(import.meta.dirname, '../../../apps/web/src/emoji');
/** As Emoji.tsx names the files: the code points, without the variation selector. */
const codeOf = (emoji: string) =>
  [...emoji]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((hex) => hex !== 'fe0f')
    .join('-');

test('every emoji in the shared data has its picture, in both sizes', () => {
  const shown = new Map<string, string>();
  const add = (emoji: string | undefined, where: string) => {
    if (emoji) shown.set(emoji, where);
  };
  for (const a of AVATARS) add(a.emoji, `avatar ${a.id}`);
  for (const e of EMOTES) add(e.emoji, `emote ${e.id}`);
  for (const a of ACHIEVEMENTS) add(a.icon, `achievement ${a.id}`);
  for (const c of CATEGORIES) add(c.icon, `category ${c.id}`);
  for (const t of MASTERY_TIERS) add(t.icon, `mastery ${t.id}`);
  const unlocks: UnlockRef[] = [
    ...AVATARS.map((a) => ({ kind: 'avatar' as const, id: a.id })),
    ...TITLES.map((t) => ({ kind: 'title' as const, id: t.id })),
    ...EMOTES.map((e) => ({ kind: 'emote' as const, id: e.id })),
  ];
  // A frame's unlock is drawn as an avatar in that frame (UnlockIcon), not by its icon.
  assert.ok(FRAMES.length > 0);
  for (const u of unlocks) add(unlockPreview(u).icon, `unlock ${u.kind} ${u.id}`);
  assert.ok(shown.size > 50, `only ${shown.size} emoji found`);
  const missing = [...shown].filter(
    ([emoji]) =>
      !fs.existsSync(path.join(ART, `${codeOf(emoji)}.webp`)) ||
      !fs.existsSync(path.join(ART, '64', `${codeOf(emoji)}.webp`)),
  );
  assert.deepEqual(
    missing.map(([emoji, where]) => `${emoji} (${codeOf(emoji)}, ${where})`),
    [],
  );
});
