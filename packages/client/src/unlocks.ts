import {
  AVATARS,
  achievementById,
  categoryById,
  EMOTES,
  FRAMES,
  levelFromXp,
  MASTERY_TIERS,
  type MeUser,
  RANK_TIERS,
  type Requirement,
  TITLES,
  type UnlockContext,
  type UnlockRef,
} from '@almanac/shared';

/** An item's own name („Видра“), without its kind. */
export function itemName(u: UnlockRef): string {
  const list = { avatar: AVATARS, frame: FRAMES, title: TITLES, emote: EMOTES }[u.kind] as {
    id: string;
    name?: string;
  }[];
  return list.find((x) => x.id === u.id)?.name ?? '';
}

/** What kind of item it is, in a word (an option's caption). */
export const ITEM_KIND: Record<UnlockRef['kind'], string> = {
  avatar: 'аватар',
  frame: 'рамка',
  title: 'титла',
  emote: 'емоция',
};

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
  }
}

export function requirementLabel(req: Requirement, compact = false): string {
  if ('level' in req) return `Ниво ${req.level}`;
  if ('season' in req) {
    const tier = RANK_TIERS.find((t) => t.id === req.season)!.name;
    return compact ? `🏅 Сезон ${tier}` : `Завърши сезон в ранг ${tier} или по-висок`;
  }
  if ('mastery' in req) {
    const tier = MASTERY_TIERS[req.mastery.tier];
    const category = categoryById(req.mastery.category)?.name;
    return compact ? `${tier.icon} ${tier.name}` : `Стани ${tier.name} в „${category}“`;
  }
  if ('evening' in req) return compact ? '🌙 Шампион' : 'Спечели „Вечерен Роял“ (за един ден)';
  if ('choice' in req) return compact ? `🎁 Ниво ${req.choice}` : `Избери го на ниво ${req.choice} (едно от две)`;
  const name = achievementById(req.achievement)?.name ?? req.achievement;
  return compact ? `🏆 ${name}` : `Постижение „${name}“`;
}

export function unlockContextOf(me: MeUser): UnlockContext {
  return {
    level: levelFromXp(me.xp),
    achievements: new Set(me.achievements),
    seasonTier: me.bestSeasonTier,
    mastery: Object.fromEntries(me.mastery.map((m) => [m.category, m.tier])),
    eveningChampion: me.eveningChampion,
    chosen: new Set(me.chosen),
  };
}
