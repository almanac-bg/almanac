import {
  achievementById,
  AVATARS,
  EMOTES,
  FRAMES,
  levelFromXp,
  type MeUser,
  POWERUPS,
  RANK_TIERS,
  type Requirement,
  TITLES,
  type UnlockContext,
  type UnlockRef,
} from '@quiz/shared';

export function unlockPreview(u: UnlockRef): { icon: string; name: string } {
  switch (u.kind) {
    case 'avatar': {
      const a = AVATARS.find((x) => x.id === u.id)!;
      return { icon: a.emoji, name: `Аватар „${a.name}“` };
    }
    case 'frame':
      return { icon: '⭕', name: `Рамка „${FRAMES.find((x) => x.id === u.id)!.name}“` };
    case 'title':
      return { icon: '🏷️', name: `Титла „${TITLES.find((x) => x.id === u.id)!.name}“` };
    case 'emote':
      return { icon: EMOTES.find((x) => x.id === u.id)!.emoji, name: 'Нова емоция' };
    case 'powerup': {
      const p = POWERUPS.find((x) => x.id === u.id)!;
      return { icon: p.icon, name: `Жокер „${p.name}“` };
    }
  }
}

export function requirementLabel(req: Requirement, compact = false): string {
  if ('level' in req) return `Ниво ${req.level}`;
  if ('season' in req) {
    const tier = RANK_TIERS.find((t) => t.id === req.season)!.name;
    return compact ? `🏅 Сезон ${tier}` : `Завърши сезон в ранг ${tier} или по-високо`;
  }
  const name = achievementById(req.achievement)?.name ?? req.achievement;
  return compact ? `🏆 ${name}` : `Постижение „${name}“`;
}

export function unlockContextOf(me: MeUser): UnlockContext {
  return { level: levelFromXp(me.xp), achievements: new Set(me.achievements), seasonTier: me.bestSeasonTier };
}
